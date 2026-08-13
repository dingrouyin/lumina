import { useState, useCallback } from 'react';

export interface UseImageGenerationReturn {
  generate: (prompt: string, aspectRatio: string, inputImageDataUrls?: string[], editMode?: string, model?: string, resolution?: string) => Promise<string | null>;
  isLoading: boolean;
  error: string | null;
  translatedPrompt: string | null;
  usedModel: string | null;
  clearError: () => void;
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

export function useImageGeneration(): UseImageGenerationReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [translatedPrompt, setTranslatedPrompt] = useState<string | null>(null);
  const [usedModel, setUsedModel] = useState<string | null>(null);

  const clearError = useCallback(() => { setError(null); setTranslatedPrompt(null); setUsedModel(null); }, []);

  const generate = useCallback(async (
    prompt: string,
    aspectRatio: string,
    inputImageDataUrls?: string[],
    editMode?: string,
    model?: string,
    resolution?: string,
  ): Promise<string | null> => {
    if (!prompt.trim()) {
      setError('请输入提示词');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 从每张 data URL 中拆出 base64 和 mimeType
      const images = (inputImageDataUrls || []).map((dataUrl) => {
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx === -1) return null;
        const base64 = dataUrl.slice(commaIdx + 1);
        const meta = dataUrl.slice(0, commaIdx); // e.g. "data:image/png;base64"
        const mimeType = meta.split(':')[1]?.split(';')[0] || 'image/png';
        return { base64, mimeType };
      }).filter((img): img is { base64: string; mimeType: string } => img !== null);

      const body: Record<string, unknown> = { prompt: prompt.trim(), aspectRatio };
      if (images.length > 0) {
        body.images = images;
        body.editMode = editMode || 'EDIT_MODE_DEFAULT';
      }
      if (model) {
        body.model = model;
      }
      if (resolution) {
        body.resolution = resolution;
      }

      const response = await fetch(`${API_BASE}/api/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(55000),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `服务器错误 (${response.status})`);
      }

      const { imageBase64, mimeType = 'image/png', finalPrompt, model: responseModel } = data;
      if (!imageBase64) throw new Error('未收到图片数据，请重试');

      if (finalPrompt) setTranslatedPrompt(finalPrompt);
      if (responseModel) setUsedModel(responseModel);
      return `data:${mimeType};base64,${imageBase64}`;

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      if (msg.includes('TimeoutError') || msg.includes('AbortError') || msg.includes('abort')) {
        setError('请求超时，请简化描述后重试');
      } else {
        setError(msg);
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { generate, isLoading, error, translatedPrompt, usedModel, clearError };
}
