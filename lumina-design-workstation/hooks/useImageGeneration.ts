import { useState, useCallback } from 'react';

export interface UseImageGenerationReturn {
  generate: (prompt: string, aspectRatio: string) => Promise<string | null>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

// 本地开发走 3001，生产环境走相对路径
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

export function useImageGeneration(): UseImageGenerationReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const generate = useCallback(async (prompt: string, aspectRatio: string): Promise<string | null> => {
    if (!prompt.trim()) {
      setError('请输入 Prompt');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), aspectRatio }),
        signal: AbortSignal.timeout(35000), // 比后端多 5 秒的容错
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `服务器错误 (${response.status})`);
      }

      const { imageBase64, mimeType = 'image/png' } = data;
      if (!imageBase64) {
        throw new Error('未收到图片数据，请重试');
      }

      // 转换为 data URL，供画布直接使用
      return `data:${mimeType};base64,${imageBase64}`;

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      if (msg.includes('TimeoutError') || msg.includes('AbortError') || msg.includes('abort')) {
        setError('生图超时，请简化 Prompt 后重试');
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
