import { GoogleAuth } from 'google-auth-library';

const LOCATION = 'us-central1';
const GEN_MODEL = 'imagen-3.0-fast-generate-001';   // 文生图
const EDIT_MODEL = 'imagen-3.0-capability-001';      // 图像编辑
const GEMINI_MODEL = 'gemini-2.0-flash-001';         // 中文翻译

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

async function translateToEnglish(text, accessToken, projectId) {
  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent`;
  const body = {
    contents: [{
      role: 'user',
      parts: [{ text: `Convert the following text into a concise English visual description suitable for an image generation model (Imagen 3). Return ONLY a short noun-phrase describing what should visually appear in the image. Do NOT include words like "generate", "create", "make", "image", or "picture". Just describe the visual subject and style.\n\nInput: ${text}\n\nEnglish visual description:` }],
    }],
  };
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return text;
    const data = await resp.json();
    const translated = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return translated || text;
  } catch {
    return text; // 翻译失败时原样发送
  }
}

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
  } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: '请输入提示词' });
  }
  if (prompt.length > 500) {
    return res.status(400).json({ error: 'Prompt 最多 500 字符' });
  }

  const isEditMode = Boolean(inputImageBase64);

  const projectId = process.env.VERTEX_PROJECT_ID;
  const clientEmail = process.env.VERTEX_CLIENT_EMAIL;
  let privateKey = process.env.VERTEX_PRIVATE_KEY || '';
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.error('[generate-image] 环境变量缺失:', {
      projectId: projectId ? '✅' : '❌',
      clientEmail: clientEmail ? '✅' : '❌',
      privateKey: privateKey ? '✅' : '❌',
    });
    return res.status(500).json({ error: '服务器配置错误：缺少 Google Cloud 凭证' });
  }

  try {
    const auth = new GoogleAuth({
      credentials: { client_email: clientEmail, private_key: privateKey },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;
    if (!accessToken) throw new Error('无法获取 Google Cloud 访问令牌');

    // 中文 prompt 自动翻译为英文（Imagen 3 中文支持差）
    let finalPrompt = prompt.trim();
    if (hasChinese(finalPrompt)) {
      const translated = await translateToEnglish(finalPrompt, accessToken, projectId);
      console.log(`[generate-image] 翻译: "${finalPrompt}" → "${translated}"`);
      finalPrompt = translated;
    }

    let endpoint, requestBody;

    if (isEditMode) {
      endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${EDIT_MODEL}:predict`;
      requestBody = {
        instances: [{
          prompt: finalPrompt,
          image: { bytesBase64Encoded: inputImageBase64 },
        }],
        parameters: {
          editConfig: { editMode },
          sampleCount: 1,
        },
      };
    } else {
      endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${GEN_MODEL}:predict`;
      requestBody = {
        instances: [{ prompt: prompt.trim() }],
        parameters: {
          sampleCount: 1,
          aspectRatio,
          safetyFilterLevel: 'block_some',
          personGeneration: 'allow_adult',
        },
      };
    }

    console.log(`[generate-image] mode=${isEditMode ? `edit(${editMode})` : 'generate'}, promptLen=${prompt.length}`);
    const startTime = Date.now();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[generate-image] API 报错 ${response.status}:`, errText);
      if (response.status === 403) return res.status(403).json({ error: 'Imagen 权限不足，请确保 Service Account 有 Vertex AI User 角色，并在 GCP 控制台启用了 Imagen 模型' });
      if (response.status === 404) return res.status(404).json({ error: '找不到 Imagen 模型，请检查 GCP 项目区域（需 us-central1）' });
      if (response.status === 429) return res.status(429).json({ error: '请求过于频繁，请稍后重试' });
      return res.status(response.status).json({ error: `API 错误 (${response.status})：${errText.substring(0, 200)}` });
    }

    const data = await response.json();
    console.log(`[generate-image] 完成，耗时 ${elapsed}s`);

    const prediction = data?.predictions?.[0];
    const imageBase64 = prediction?.bytesBase64Encoded;
    const mimeType = prediction?.mimeType || 'image/png';

    if (!imageBase64) {
      console.error('[generate-image] 无图片数据:', JSON.stringify(data).substring(0, 300));
      throw new Error('服务返回了空结果，请重试');
    }

    return res.status(200).json({ imageBase64, mimeType });

  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({ error: '请求超时（>30秒），请稍后重试或简化描述' });
    }
    console.error('[generate-image] 未知错误:', error?.message || error);
    return res.status(500).json({ error: `失败：${error?.message || '未知错误'}` });
  }
}
