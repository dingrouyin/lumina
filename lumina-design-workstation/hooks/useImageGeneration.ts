import { useState, useCallback } from 'react';

export interface UseImageGenerationReturn {
  generate: (prompt: string, aspectRatio: string, inputImageDataUrl?: string, editMode?: string) => Promise<string | null>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

export function useImageGeneration(): UseImageGenerationReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const generate = useCallback(async (
    prompt: string,
    aspectRatio: string,
    inputImageDataUrl?: string,
    editMode?: string,
  ): Promise<string | null> => {
    if (!prompt.trim()) {
      setError('请输入提示词');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 从 data URL 中拆出 base64 和 mimeType
      let inputImageBase64: string | undefined;
      let inputMimeType: string | undefined;
      if (inputImageDataUrl) {
        const commaIdx = inputImageDataUrl.indexOf(',');
        if (commaIdx !== -1) {
          inputImageBase64 = inputImageDataUrl.slice(commaIdx + 1);
          const meta = inputImageDataUrl.slice(0, commaIdx); // e.g. "data:image/png;base64"
          inputMimeType = meta.split(':')[1]?.split(';')[0] || 'image/png';
        }
      }

      const body: Record<string, unknown> = { prompt: prompt.trim(), aspectRatio };
      if (inputImageBase64) {
        body.inputImageBase64 = inputImageBase64;
        body.inputMimeType = inputMimeType;
        body.editMode = editMode || 'EDIT_MODE_DEFAULT';
      }

      const response = await fetch(`${API_BASE}/api/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(35000),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `服务器错误 (${response.status})`);
      }

      const { imageBase64, mimeType = 'image/png' } = data;
      if (!imageBase64) throw new Error('未收到图片数据，请重试');

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

  return { generate, isLoading, error, clearError };
}
