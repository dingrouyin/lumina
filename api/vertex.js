import { VertexAI } from '@google-cloud/vertexai';

export default async function handler(req, res) {
    // 只允许 POST 请求，防止别人用浏览器乱点
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { prompt, images } = req.body;

        let privateKey = process.env.VERTEX_PRIVATE_KEY || '';
        if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
            privateKey = privateKey.slice(1, -1);
        }
        privateKey = privateKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');

        // 1. 拿出我们刚刚锁在 Vercel 里的电子工牌
        const vertex_ai = new VertexAI({
            project: process.env.VERTEX_PROJECT_ID,
            location: 'us-central1',
            googleAuthOptions: {
                credentials: {
                    client_email: process.env.VERTEX_CLIENT_EMAIL,
                    private_key: privateKey,
                }
            }
        });

        // 2. 呼叫企业通道的 2.5-pro 顶级模型
        const model = vertex_ai.preview.getGenerativeModel({
            model: 'gemini-2.5-pro',
        });

        // 3. 构建多模态请求体
        const parts = [];
        if (images && Array.isArray(images)) {
            images.forEach(img => {
                if (img.data) {
                    parts.push({
                        inlineData: {
                            data: img.data,
                            mimeType: img.mimeType || 'image/png'
                        }
                    });
                }
            });
        }
        parts.push({ text: prompt });

        const request = {
            contents: [{ role: 'user', parts: parts }]
        };

        // 4. 发送你在画板里问的问题和所有图片
        const response = await model.generateContent(request);
        const text = response.response.candidates[0].content.parts[0].text;

        // 4. 把干干净净的文字结果送回给前端
        res.status(200).json({ text });

    } catch (error) {
        console.error("Vertex AI 接口报错:", error);
        res.status(500).json({ error: 'AI 请求失败，请检查控制台' });
    }
}