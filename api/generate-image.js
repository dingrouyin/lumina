const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/images';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';
const ALLOWED_MODELS = ['google/gemini-2.5-flash-image', 'bytedance-seed/seedream-4.5'];
const MAX_PROMPT_LENGTH = 500;

// undici 默认连接超时 10s，境外域名网络抖动时容易在建连阶段就失败（fetch failed）
// 这类网络层错误重试几次往往就能成功，和真正的 HTTP 错误响应分开处理
function isNetworkError(error) {
  const code = error?.cause?.code;
  return code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || error?.message === 'fetch failed';
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
  EDIT_MODE_DEFAULT: (p) => `请按照以下指令修改这张参考图，除了指令要求修改的部分，其余画面（构图、主体、细节、光影）必须保持完全一致，不要重新生成整张图：${p}`,
  EDIT_MODE_BGSWAP: (p) => `请将这张参考图的背景替换为：${p}。主体物体本身的形状、颜色、材质、文字必须保持完全不变，只替换背景环境。`,
  EDIT_MODE_PRODUCT_IMAGE: (p) => `请把这张参考图中的产品放置到新的场景中：${p}。产品本身的外观、材质、比例、文字必须保持完全一致，不要重新设计产品，只改变周围环境和光影。`,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const {
    prompt,
    aspectRatio = '1:1',
    inputImageBase64,
    inputMimeType = 'image/png',
    editMode = 'EDIT_MODE_DEFAULT',
    model,
  } = req.body;

  const selectedModel = ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: '请输入生图 Prompt' });
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({ error: `Prompt 最多 ${MAX_PROMPT_LENGTH} 字符` });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('[generate-image] 环境变量缺失: OPENROUTER_API_KEY 未设置');
    return res.status(500).json({ error: '服务器配置错误：缺少 OPENROUTER_API_KEY' });
  }

  const isEditMode = Boolean(inputImageBase64);

  const requestBody = { model: selectedModel };
  if (isEditMode) {
    const template = EDIT_MODE_TEMPLATES[editMode] || EDIT_MODE_TEMPLATES.EDIT_MODE_DEFAULT;
    requestBody.prompt = template(prompt.trim());
    requestBody.input_references = [
      {
        type: 'image_url',
        image_url: { url: `data:${inputMimeType};base64,${inputImageBase64}` },
      },
    ];
  } else {
    requestBody.prompt = `${prompt.trim()}（画面比例 ${aspectRatio}）`;
  }

  console.log(`[generate-image] 开始生图，model=${selectedModel}, mode=${isEditMode ? `edit(${editMode})` : 'generate'}, promptLen=${prompt.length}`);
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

    return res.status(200).json({ imageBase64, mimeType, model: selectedModel });

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
