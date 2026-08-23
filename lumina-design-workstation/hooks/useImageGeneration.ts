import { useState, useCallback } from 'react';

export interface GenerateResult {
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface BatchGenerateResult {
  results: GenerateResult[]; // 已成功生成的结果，按变体顺序排列
  failedAt: number | null;   // 失败在第几个变体（0-based），全部成功则为 null
}

export interface UseImageGenerationReturn {
  generate: (prompt: string, aspectRatio: string, inputImageDataUrls?: string[], editMode?: string, model?: string, resolution?: string) => Promise<GenerateResult | null>;
  // 批量换道具：baseImageDataUrl（底图）分别和 variantImageDataUrls 里的每一张组成 [底图, 变体] 两图参考，依次调用 generate()
  generateBatch: (prompt: string, baseImageDataUrl: string, variantImageDataUrls: string[], editMode?: string, model?: string, resolution?: string) => Promise<BatchGenerateResult>;
  isLoading: boolean;
  batchProgress: { current: number; total: number } | null;
  error: string | null;
  translatedPrompt: string | null;
  usedModel: string | null;
  outputDimensions: { width: number; height: number } | null;
  clearError: () => void;
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

export function useImageGeneration(): UseImageGenerationReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [translatedPrompt, setTranslatedPrompt] = useState<string | null>(null);
  const [usedModel, setUsedModel] = useState<string | null>(null);
  const [outputDimensions, setOutputDimensions] = useState<{ width: number; height: number } | null>(null);

  const clearError = useCallback(() => {
    setError(null);
    setTranslatedPrompt(null);
    setUsedModel(null);
    setOutputDimensions(null);
  }, []);

  const generate = useCallback(async (
    prompt: string,
    aspectRatio: string,
    inputImageDataUrls?: string[],
    editMode?: string,
    model?: string,
    resolution?: string,
  ): Promise<GenerateResult | null> => {
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

      const { imageBase64, mimeType = 'image/png', finalPrompt, model: responseModel, width, height } = data;
      if (!imageBase64) throw new Error('未收到图片数据，请重试');

      if (finalPrompt) setTranslatedPrompt(finalPrompt);
      if (responseModel) setUsedModel(responseModel);
      if (width && height) setOutputDimensions({ width, height });
      return { dataUrl: `data:${mimeType};base64,${imageBase64}`, width, height };

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

  // 批量换道具 MVP：不做失败重试，某一张失败就停在那一张，把已经成功的结果和失败位置一起报给调用方
  const generateBatch = useCallback(async (
    prompt: string,
    baseImageDataUrl: string,
    variantImageDataUrls: string[],
    editMode?: string,
    model?: string,
    resolution?: string,
  ): Promise<BatchGenerateResult> => {
    const results: GenerateResult[] = [];
    setBatchProgress({ current: 0, total: variantImageDataUrls.length });

    for (let i = 0; i < variantImageDataUrls.length; i++) {
      setBatchProgress({ current: i + 1, total: variantImageDataUrls.length });
      const result = await generate(prompt, '1:1', [baseImageDataUrl, variantImageDataUrls[i]], editMode, model, resolution);
      if (!result) {
        setBatchProgress(null);
        return { results, failedAt: i };
      }
      results.push(result);
    }

    setBatchProgress(null);
    return { results, failedAt: null };
  }, [generate]);

  return { generate, generateBatch, isLoading, batchProgress, error, translatedPrompt, usedModel, outputDimensions, clearError };
}
