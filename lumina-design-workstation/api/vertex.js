import { VertexAI } from '@google-cloud/vertexai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { prompt, images } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: '缺少 prompt' });
    }

    let privateKey = process.env.VERTEX_PRIVATE_KEY || '';
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');

    if (!process.env.VERTEX_PROJECT_ID || !process.env.VERTEX_CLIENT_EMAIL || !privateKey) {
      console.error('[vertex] 环境变量缺失');
      return res.status(500).json({ error: 'AI 服务配置错误，请联系管理员' });
    }

    const vertex_ai = new VertexAI({
      project: process.env.VERTEX_PROJECT_ID,
      location: 'us-central1',
      googleAuthOptions: {
        credentials: {
          client_email: process.env.VERTEX_CLIENT_EMAIL,
          private_key: privateKey,
        },
      },
    });

    const model = vertex_ai.preview.getGenerativeModel({
      model: 'gemini-1.5-flash',
    });

    const parts = [];
    if (images && Array.isArray(images)) {
      images.forEach(img => {
        if (img.data) {
          parts.push({ inlineData: { data: img.data, mimeType: img.mimeType || 'image/png' } });
        }
      });
    }
    parts.push({ text: prompt });

    const request = { contents: [{ role: 'user', parts }] };

    console.log(`[vertex] 开始请求 gemini-1.5-flash，图片数: ${images?.length || 0}`);
    const startTime = Date.now();

    const streamResult = await model.generateContentStream(request);

    let fullText = '';
    for await (const chunk of streamResult.stream) {
      fullText += chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[vertex] 完成，耗时 ${elapsed}s，字符数: ${fullText.length}`);

    if (!fullText) throw new Error('AI 返回了空响应');

    res.status(200).json({ text: fullText });

  } catch (error) {
    console.error('[vertex] 报错:', error?.message || error);
    res.status(500).json({ error: `AI 请求失败: ${error?.message || '未知错误'}` });
  }
}
