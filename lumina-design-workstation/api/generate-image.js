const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/images';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';
const ALLOWED_MODELS = [
  'google/gemini-2.5-flash-image',
  'bytedance-seed/seedream-4.5',
  'google/gemini-3.1-flash-lite-image',
  'black-forest-labs/flux.2-klein-4b',
  'openai/gpt-image-2',
];
const MAX_PROMPT_LENGTH = 500;

// 各模型能接受的最大参考图张数（查 OpenRouter /api/v1/images/models 的 input_references 字段得来）。
// 前端画布连线最多让用户关联 4 张，但 Gemini 2.5 Flash Image 这个默认模型实际只吃 3 张，这里按模型分别校验，
// 不在名单里的模型（理论上不会发生，因为 selectedModel 已经过 ALLOWED_MODELS 白名单校验）保守按 3 处理
const MODEL_MAX_REFERENCE_IMAGES = {
  'google/gemini-2.5-flash-image': 3,
  'bytedance-seed/seedream-4.5': 4,
  'google/gemini-3.1-flash-lite-image': 4,
  'black-forest-labs/flux.2-klein-4b': 4,
  'openai/gpt-image-2': 4,
};

// 每个模型能接受的 resolution 枚举值不同（查 OpenRouter /api/v1/images/models 得来），
// 目前候选模型里只有 Seedream 4.5 支持这个字段，其余模型没有该 supported_parameter，
// 传了会被 OpenRouter 拒绝，所以按模型白名单校验，不支持的模型直接忽略该参数
const MODEL_RESOLUTIONS = {
  'bytedance-seed/seedream-4.5': ['1K', '2K', '4K'],
};

// undici 默认连接超时 10s，境外域名网络抖动时容易在建连阶段就失败（fetch failed）
// 只重试"确定还没把请求发出去"的连接阶段错误——ECONNRESET/ETIMEDOUT 可能发生在
// 请求体已经送达 OpenRouter、对方已经开始计费生成之后，重试会有重复扣费的风险，不做自动重试
function isNetworkError(error) {
  return error?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';
}

async function fetchWithRetry(url, options, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (error.name === 'AbortError' || attempt === maxAttempts || !isNetworkError(error)) throw error;
      console.warn(`[generate-image] 网络层请求失败(第 ${attempt}/${maxAttempts} 次): ${error?.cause?.code || error.message}，即将重试`);
    }
  }
}

// 局部重绘没有单独的 mask 参数，靠 prompt 明确"只改标记区域、其余保持不变"
const EDIT_MODE_TEMPLATES = {
  EDIT_MODE_DEFAULT: (p) => `请按照以下指令修改参考图，除了指令要求修改的部分，其余画面（构图、主体、细节、光影）必须保持完全一致，不要重新生成整张图：${p}`,
  // 更换场景：保留主体，替换环境的同时重新匹配光影，避免"抠图感"
  EDIT_MODE_BGSWAP: (p) => `请将参考图的场景/背景替换为：${p}。主体物体本身的形状、颜色、材质、文字必须保持完全不变；同时需要根据新场景重新匹配光影方向、色温和阴影，让主体自然融入新环境，不要出现抠图拼贴的违和感。`,
  // 产品主体：不改场景，只改观察视角——用于补齐产品缺失的机位（正视/俯视/侧视/背面等）
  EDIT_MODE_PRODUCT_IMAGE: (p) => `请基于参考图中的产品主体，生成从新视角/机位观察到的画面：${p}。必须是同一件产品——外观、颜色、材质、比例、文字或图案等细节要与参考图完全一致，只改变观察角度（例如正视、俯视、侧视、45度角、背面等），不要更改产品本身的设计，除非指令特别要求，否则背景环境保持简洁、不做无关改动。`,
};

// OpenRouter 的响应里没有返回实际输出的像素尺寸（只有 b64_json/media_type），
// 请求的 resolution 参数也不代表模型一定照办，所以直接解析图片文件头拿真实尺寸，
// 而不是简单回显请求时传的 resolution 档位
function getImageDimensions(buffer, mimeType) {
  try {
    if (mimeType === 'image/png' || (buffer[0] === 0x89 && buffer[1] === 0x50)) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mimeType === 'image/jpeg' || (buffer[0] === 0xff && buffer[1] === 0xd8)) {
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSOF) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
    }
  } catch (e) {
    console.warn('[generate-image] 解析图片尺寸失败:', e.message);
  }
  return null;
}

// 多张参考图时，在指令前加一句说明，让模型能对上用户文字里写的"图1/图2"
function buildReferencePreface(imageCount) {
  if (imageCount <= 1) return '';
  const labels = Array.from({ length: imageCount }, (_, i) => `图${i + 1}`).join('、');
  return `以下提供了 ${imageCount} 张参考图，按提供顺序依次对应指令里提到的${labels}；请结合指令，正确理解每张图分别扮演什么角色（例如哪张是主体、哪张是场景），再进行合成或修改。\n\n`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const {
    prompt,
    aspectRatio = '1:1',
    images,
    editMode = 'EDIT_MODE_DEFAULT',
    model,
    resolution,
  } = req.body;

  const selectedModel = ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: '请输入生图 Prompt' });
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({ error: `Prompt 最多 ${MAX_PROMPT_LENGTH} 字符` });
  }

  const referenceImages = Array.isArray(images) ? images.filter(img => img?.base64) : [];
  const maxRefsForModel = MODEL_MAX_REFERENCE_IMAGES[selectedModel] ?? 3;
  if (referenceImages.length > maxRefsForModel) {
    return res.status(400).json({ error: `模型「${selectedModel}」最多支持 ${maxRefsForModel} 张参考图，请切换模型或减少参考图` });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('[generate-image] 环境变量缺失: OPENROUTER_API_KEY 未设置');
    return res.status(500).json({ error: '服务器配置错误：缺少 OPENROUTER_API_KEY' });
  }

  const isEditMode = referenceImages.length > 0;

  const requestBody = { model: selectedModel };
  if (MODEL_RESOLUTIONS[selectedModel]?.includes(resolution)) {
    requestBody.resolution = resolution;
  }
  if (isEditMode) {
    const template = EDIT_MODE_TEMPLATES[editMode] || EDIT_MODE_TEMPLATES.EDIT_MODE_DEFAULT;
    requestBody.prompt = buildReferencePreface(referenceImages.length) + template(prompt.trim());
    requestBody.input_references = referenceImages.map(img => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType || 'image/png'};base64,${img.base64}` },
    }));
  } else {
    requestBody.prompt = `${prompt.trim()}（画面比例 ${aspectRatio}）`;
  }

  console.log(`[generate-image] 开始生图，model=${selectedModel}, mode=${isEditMode ? `edit(${editMode})` : 'generate'}, refImages=${referenceImages.length}, promptLen=${prompt.length}`);
  const startTime = Date.now();

  // 用同一个 controller 控制总耗时上限（留余量给 vercel.json 里的 60s maxDuration），
  // 重试共享这个预算，不会因为重试把总时间拖到 maxDuration 之外
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 50000);

  try {
    const response = await fetchWithRetry(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    }, 3);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[generate-image] OpenRouter API 报错 ${response.status} (耗时 ${elapsed}s):`, errText);

      if (response.status === 401) {
        return res.status(401).json({ error: 'OPENROUTER_API_KEY 无效或未授权，请检查 Vercel 环境变量' });
      }
      if (response.status === 402) {
        return res.status(402).json({ error: 'OpenRouter 账户余额不足，请前往 OpenRouter 充值' });
      }
      if (response.status === 429) {
        return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
      }
      return res.status(response.status).json({ error: `生图 API 错误 (${response.status})：${errText.substring(0, 200)}` });
    }

    const data = await response.json();
    console.log(`[generate-image] 生图完成，耗时 ${elapsed}s`);

    const result = data?.data?.[0];
    const imageBase64 = result?.b64_json;
    const mimeType = result?.media_type || 'image/png';

    if (!imageBase64) {
      console.error('[generate-image] 响应中无图片数据:', JSON.stringify(data).substring(0, 300));
      throw new Error('生图服务返回了空结果，请重试');
    }

    const dimensions = getImageDimensions(Buffer.from(imageBase64, 'base64'), mimeType);

    return res.status(200).json({
      imageBase64,
      mimeType,
      model: selectedModel,
      width: dimensions?.width,
      height: dimensions?.height,
    });

  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({ error: '生图超时（>50秒），请稍后重试或简化 Prompt' });
    }
    console.error('[generate-image] 未知错误:', error?.message || error);
    if (error?.cause) {
      console.error('[generate-image] 错误 cause:', error.cause);
    }
    return res.status(500).json({ error: `生图失败：${error?.message || '未知错误'}` });
  } finally {
    clearTimeout(abortTimer);
  }
}
