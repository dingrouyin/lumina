import { CanvasElement } from "../types";
import { generateSystemPrompt } from "./aiPrompts";




// 触发 AI 对话的请求函数
export const getAIResponse = async (
  userInput: string,
  selectedElements: CanvasElement[],
  globalScreenshotBase64?: string
): Promise<string> => {
  try {
    const systemPrompt = generateSystemPrompt({
      userRole: "电商设计师",
      tone: "professional",
      preferredStyle: "通用电商"
    });

    let contextText = "";
    let images: { data: string; mimeType: string }[] = [];

    if (globalScreenshotBase64) {
      contextText += `[Context: 已提供全局画布截图，请结合截图分析。如果有选中的元素，重点分析选中的部分]\n`;
      const base64Str = globalScreenshotBase64.replace(/^data:image\/\w+;base64,/, "");
      images.push({ data: base64Str, mimeType: "image/png" });
    } 
    
    if (selectedElements.length > 0) {
      contextText += `[Context: 用户选中了以下素材(已提供原图数据)]\n`;
      selectedElements.forEach((el, index) => {
        contextText += `- 素材${index + 1}: 类型 ${el.type}, 名称 ${el.name || '无'}\n`;
        if (el.type === 'image' && el.content && el.content.startsWith('data:image')) {
           const base64Str = el.content.replace(/^data:image\/\w+;base64,/, "");
           images.push({ data: base64Str, mimeType: "image/png" });
        }
      });
    } else if (!globalScreenshotBase64) {
      contextText += "[Context: 画布目前处于空白状态。]\n";
    }

    const fullPrompt = `${systemPrompt}\n\n${contextText}\nUser Question: ${userInput}`;

    // 呼叫我们刚刚建好的隐形前台
    const response = await fetch('/api/vertex', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // 将文字提示词和图片数组一起发送
      body: JSON.stringify({ prompt: fullPrompt, images })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    // data.text 就是干干净净的 AI 回复，直接把它渲染到你的画板对话气泡里
    return data.text;

  } catch (error) {
    console.error("请求隐形前台失败:", error);
    return "网络线路似乎有点小波动，请按 F12 检查控制台报错哦。";
  }
};

export const analyzeImageRegion = async (base64Data: string, prompt: string): Promise<string> => {
  return "暂不支持区域分析";
};
