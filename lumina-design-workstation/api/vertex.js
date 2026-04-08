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

        // 4. 使用流式传输，避免长时间阻塞连接（gemini-2.5-pro 思考模型可能需要较长时间）
        console.log(`[Lumina AI] 开始请求 gemini-2.5-pro，图片数量: ${images?.length || 0}`);
        const startTime = Date.now();

        const streamResult = await model.generateContentStream(request);

        // 5. 收集所有流式 chunk 拼合为最终文本
        let fullText = '';
        for await (const chunk of streamResult.stream) {
            const chunkText = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
            fullText += chunkText;
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Lumina AI] 响应完成，耗时 ${elapsed}s，字符数: ${fullText.length}`);

        if (!fullText) {
            throw new Error('AI 返回了空响应');
        }

        // 6. 把干干净净的文字结果送回给前端
        res.status(200).json({ text: fullText });

    } catch (error) {
        console.error("Vertex AI 接口报错:", error?.message || error);
        console.error("错误详情:", JSON.stringify({
            project: process.env.VERTEX_PROJECT_ID ? '✅ 已设置' : '❌ 未设置',
            email: process.env.VERTEX_CLIENT_EMAIL ? '✅ 已设置' : '❌ 未设置',
            key: process.env.VERTEX_PRIVATE_KEY ? '✅ 已设置' : '❌ 未设置',
        }));
        res.status(500).json({ error: `AI 请求失败: ${error?.message || '未知错误'}` });
    }
}