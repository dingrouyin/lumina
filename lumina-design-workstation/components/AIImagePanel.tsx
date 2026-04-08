import React, { useState, useRef, useEffect } from 'react';
import { useImageGeneration } from '../hooks/useImageGeneration';

interface AIImagePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertImage: (dataUrl: string, width: number, height: number) => void;
  onShowToast: (msg: string) => void;
}

const ASPECT_RATIOS = [
  { label: '1:1', value: '1:1', w: 512, h: 512 },
  { label: '16:9', value: '16:9', w: 640, h: 360 },
  { label: '9:16', value: '9:16', w: 360, h: 640 },
  { label: '4:3', value: '4:3', w: 512, h: 384 },
] as const;

const MAX_PROMPT_LENGTH = 500;

const AIImagePanel: React.FC<AIImagePanelProps> = ({ isOpen, onClose, onInsertImage, onShowToast }) => {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { generate, isLoading, error, clearError } = useImageGeneration();

  // 面板打开时自动聚焦
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleGenerate = async () => {
    if (!prompt.trim() || isLoading) return;
    clearError();

    const dataUrl = await generate(prompt, aspectRatio);

    if (dataUrl) {
      const selected = ASPECT_RATIOS.find(r => r.value === aspectRatio) || ASPECT_RATIOS[0];
      onInsertImage(dataUrl, selected.w, selected.h);
      onShowToast('✨ 图片已生成并插入画布');
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleGenerate();
    }
    if (e.key === 'Escape') {
      onClose();
    }
    e.stopPropagation();
  };

  const selectedRatio = ASPECT_RATIOS.find(r => r.value === aspectRatio) || ASPECT_RATIOS[0];
  const previewAsp = selectedRatio.w / selectedRatio.h;

  if (!isOpen) return null;

  return (
    <>
      {/* 背景遮罩 - 点击关闭 */}
      <div
        className="fixed inset-0 z-[9998] bg-transparent"
        onPointerDown={(e) => { e.stopPropagation(); onClose(); }}
      />

      {/* 面板主体 */}
      <div
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999] w-[420px] bg-white/95 backdrop-blur-2xl rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] border border-white/60 overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-md shadow-violet-200">
              <i className="fa-solid fa-wand-magic-sparkles text-white text-xs" />
            </div>
            <div>
              <h3 className="text-sm font-black text-gray-800 tracking-tight">AI 生图</h3>
              <p className="text-[10px] text-gray-400 font-medium">Powered by Google Imagen 3</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <i className="fa-solid fa-xmark text-sm" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Prompt 输入区 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Prompt 描述</label>
              <span className={`text-[10px] font-mono font-bold transition-colors ${prompt.length > MAX_PROMPT_LENGTH * 0.9 ? 'text-orange-500' : 'text-gray-300'}`}>
                {prompt.length}/{MAX_PROMPT_LENGTH}
              </span>
            </div>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => {
                if (e.target.value.length <= MAX_PROMPT_LENGTH) {
                  setPrompt(e.target.value);
                  clearError();
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="描述你想生成的图片，例如：a serene mountain landscape at golden hour, photorealistic, 8K..."
              className="w-full h-[100px] resize-none bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 transition-all font-medium leading-relaxed"
              disabled={isLoading}
            />
          </div>

          {/* 比例选择 */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">图片比例</label>
            <div className="flex gap-2">
              {ASPECT_RATIOS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setAspectRatio(r.value)}
                  disabled={isLoading}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all border ${
                    aspectRatio === r.value
                      ? 'bg-violet-600 border-violet-600 text-white shadow-md shadow-violet-200'
                      : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-violet-300 hover:text-violet-600'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* 预览占位 / 加载骨架 */}
          <div
            className="w-full rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center transition-all"
            style={{ aspectRatio: `${previewAsp}`, maxHeight: 180 }}
          >
            {isLoading ? (
              <div className="w-full h-full relative overflow-hidden bg-gray-100">
                {/* 骨架屏动画 */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center shadow-lg animate-pulse">
                    <i className="fa-solid fa-paintbrush text-white text-sm" />
                  </div>
                  <p className="text-xs font-bold text-gray-400 animate-pulse">Imagen 3 正在生图…</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-6 text-gray-300">
                <i className="fa-regular fa-image text-2xl" />
                <p className="text-[11px] font-medium">生成预览将在此显示</p>
              </div>
            )}
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl text-red-600 animate-in fade-in slide-in-from-top-1">
              <i className="fa-solid fa-circle-exclamation text-sm mt-0.5 shrink-0" />
              <p className="text-xs font-medium leading-relaxed">{error}</p>
            </div>
          )}

          {/* 生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isLoading}
            className={`w-full py-3.5 rounded-2xl font-black text-sm tracking-tight transition-all ${
              !prompt.trim() || isLoading
                ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                : 'bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white shadow-lg shadow-violet-200 hover:shadow-xl hover:shadow-violet-300 hover:scale-[1.01] active:scale-[0.99]'
            }`}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <i className="fa-solid fa-spinner fa-spin" />
                生成中，请稍候…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <i className="fa-solid fa-wand-magic-sparkles" />
                生成图片
                <span className="text-[10px] opacity-60 font-medium">Ctrl+Enter</span>
              </span>
            )}
          </button>
        </div>
      </div>
    </>
  );
};

export default AIImagePanel;
