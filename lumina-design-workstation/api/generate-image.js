import { GoogleAuth } from 'google-auth-library';

const LOCATION = 'us-central1';
const MODEL = 'imagegeneration@006'; // Imagen 3 Fast

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { prompt, aspectRatio = '1:1' } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: '请输入生图 Prompt' });
  }

  if (prompt.length > 500) {
    return res.status(400).json({ error: 'Prompt 最多 500 字符' });
  }

  // --- 1. 读取 Service Account 凭证（沿用现有 VERTEX_* 变量）---
  const projectId = process.env.VERTEX_PROJECT_ID;
  const clientEmail = process.env.VERTEX_CLIENT_EMAIL;

  let privateKey = process.env.VERTEX_PRIVATE_KEY || '';
  // 处理 Vercel 环境变量中可能存在的转义字符
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
    // --- 2. 通过 Service Account 获取访问令牌 ---
    const auth = new GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;

    if (!accessToken) {
      throw new Error('无法获取 Google Cloud 访问令牌');
    }

    // --- 3. 调用 Vertex AI Imagen 3 REST API ---
    const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`;

    const requestBody = {
      instances: [
        {
          prompt: prompt.trim(),
        },
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: aspectRatio,
        safetyFilterLevel: 'block_some',
        personGeneration: 'allow_adult',
      },
    };

    console.log(`[generate-image] 开始生图，model=${MODEL}, aspectRatio=${aspectRatio}, promptLen=${prompt.length}`);
    const startTime = Date.now();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000), // 30 秒超时
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[generate-image] API 报错 ${response.status}:`, errText);

      // 友好提示常见错误
      if (response.status === 403) {
        return res.status(403).json({ error: 'Imagen 3 权限不足，请在 GCP 控制台启用 Vertex AI Imagen 模型，并确保 Service Account 有 Vertex AI User 角色' });
      }
      if (response.status === 404) {
        return res.status(404).json({ error: `找不到模型 ${MODEL}，请检查 GCP 项目区域和模型 ID` });
      }
      if (response.status === 429) {
        return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
      }
      return res.status(response.status).json({ error: `生图 API 错误 (${response.status})：${errText.substring(0, 200)}` });
    }

    const data = await response.json();
    console.log(`[generate-image] 生图完成，耗时 ${elapsed}s`);

    // --- 4. 提取 Base64 图片数据 ---
    const prediction = data?.predictions?.[0];
    const imageBase64 = prediction?.bytesBase64Encoded;
    const mimeType = prediction?.mimeType || 'image/png';

    if (!imageBase64) {
      console.error('[generate-image] 响应中无图片数据:', JSON.stringify(data).substring(0, 300));
      throw new Error('生图服务返回了空结果，请重试');
    }

    return res.status(200).json({ imageBase64, mimeType });

  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({ error: '生图超时（>30秒），请稍后重试或简化 Prompt' });
    }
    console.error('[generate-image] 未知错误:', error?.message || error);
    return res.status(500).json({ error: `生图失败：${error?.message || '未知错误'}` });
  }
}
