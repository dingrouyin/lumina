import React, { useState, useRef, useEffect } from 'react';
import { useImageGeneration } from '../hooks/useImageGeneration';

interface AIImagePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertImage: (dataUrl: string, width: number, height: number) => void;
  onShowToast: (msg: string) => void;
  selectedImageDataUrl?: string; // 若已选中画布图片，传入其 data URL
}

const ASPECT_RATIOS = [
  { label: '1:1', value: '1:1', w: 512, h: 512 },
  { label: '16:9', value: '16:9', w: 640, h: 360 },
  { label: '9:16', value: '9:16', w: 360, h: 640 },
  { label: '4:3', value: '4:3', w: 512, h: 384 },
] as const;

const EDIT_MODES = [
  {
    value: 'EDIT_MODE_DEFAULT',
    label: '自由改图',
    icon: 'fa-pen-to-square',
    hint: '描述你想对这张图做什么，例如：把天空改成夕阳，让人物戴上帽子…',
  },
  {
    value: 'EDIT_MODE_BGSWAP',
    label: '换背景',
    icon: 'fa-image',
    hint: '描述新背景，例如：a tropical beach with palm trees，北欧风简约办公室…',
  },
  {
    value: 'EDIT_MODE_PRODUCT_IMAGE',
    label: '产品图',
    icon: 'fa-box',
    hint: '描述产品所在场景，例如：placed on a marble table with soft studio lighting…',
  },
] as const;

const MAX_PROMPT_LENGTH = 500;

const AIImagePanel: React.FC<AIImagePanelProps> = ({
  isOpen,
  onClose,
  onInsertImage,
  onShowToast,
  selectedImageDataUrl,
}) => {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [editMode, setEditMode] = useState<string>('EDIT_MODE_DEFAULT');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { generate, isLoading, error, translatedPrompt, clearError } = useImageGeneration();

  const isEditMode = Boolean(selectedImageDataUrl);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
    if (isOpen) {
      setPrompt('');
      clearError();
    }
  }, [isOpen, clearError]);

  // 切换到文生图模式时重置 editMode
  useEffect(() => {
    if (!isEditMode) setEditMode('EDIT_MODE_DEFAULT');
  }, [isEditMode]);

  const handleGenerate = async () => {
    if (!prompt.trim() || isLoading) return;
    clearError();

    const dataUrl = await generate(
      prompt,
      isEditMode ? '1:1' : aspectRatio,
      isEditMode ? selectedImageDataUrl : undefined,
      isEditMode ? editMode : undefined,
    );

    if (dataUrl) {
      const selected = ASPECT_RATIOS.find(r => r.value === aspectRatio) || ASPECT_RATIOS[0];
      onInsertImage(dataUrl, selected.w, selected.h);
      onShowToast(isEditMode ? '✨ 图片已编辑并插入画布' : '✨ 图片已生成并插入画布');
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleGenerate();
    }
    if (e.key === 'Escape') onClose();
    e.stopPropagation();
  };

  const activeEditMode = EDIT_MODES.find(m => m.value === editMode) || EDIT_MODES[0];
  const selectedRatio = ASPECT_RATIOS.find(r => r.value === aspectRatio) || ASPECT_RATIOS[0];

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[9998] bg-transparent"
        onPointerDown={(e) => { e.stopPropagation(); onClose(); }}
      />

      <div
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999] w-[440px] bg-white/95 backdrop-blur-2xl rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] border border-white/60 overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-md shadow-violet-200">
              <i className={`fa-solid ${isEditMode ? 'fa-pen-to-square' : 'fa-wand-magic-sparkles'} text-white text-xs`} />
            </div>
            <div>
              <h3 className="text-sm font-black text-gray-800 tracking-tight">
                {isEditMode ? 'AI 改图' : 'AI 生图'}
              </h3>
              <p className="text-[10px] text-gray-400 font-medium">
                {isEditMode ? 'Powered by Google Imagen 3 Edit' : 'Powered by Google Imagen 3'}
              </p>
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
          {/* 编辑模式：原图预览 + 编辑类型 */}
          {isEditMode && (
            <div className="space-y-3">
              {/* 原图缩略图 */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100">
                <img
                  src={selectedImageDataUrl}
                  alt="原图"
                  className="w-12 h-12 rounded-xl object-cover border border-gray-200 shrink-0"
                />
                <div>
                  <p className="text-xs font-bold text-gray-600">当前选中图片</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">AI 将在此图基础上进行修改</p>
                </div>
              </div>

              {/* 编辑类型选择 */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">编辑方式</label>
                <div className="flex gap-2">
                  {EDIT_MODES.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => { setEditMode(m.value); clearError(); }}
                      disabled={isLoading}
                      className={`flex-1 py-2 px-1 rounded-xl text-[11px] font-bold transition-all border flex flex-col items-center gap-1 ${
                        editMode === m.value
                          ? 'bg-violet-600 border-violet-600 text-white shadow-md shadow-violet-200'
                          : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-violet-300 hover:text-violet-600'
                      }`}
                    >
                      <i className={`fa-solid ${m.icon} text-xs`} />
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Prompt 输入 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                {isEditMode ? '修改指令' : 'Prompt 描述'}
              </label>
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
              placeholder={
                isEditMode
                  ? activeEditMode.hint
                  : '描述你想生成的图片，例如：a serene mountain landscape at golden hour, photorealistic, 8K…'
              }
              className="w-full h-[90px] resize-none bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 transition-all font-medium leading-relaxed"
              disabled={isLoading}
            />
          </div>

          {/* 文生图：比例选择 */}
          {!isEditMode && (
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
          )}

          {/* 预览/加载区 */}
          <div
            className="w-full rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center"
            style={isEditMode ? { height: 80 } : { aspectRatio: `${selectedRatio.w / selectedRatio.h}`, maxHeight: 160 }}
          >
            {isLoading ? (
              <div className="w-full h-full relative overflow-hidden bg-gray-100">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center shadow-lg animate-pulse">
                    <i className="fa-solid fa-paintbrush text-white text-xs" />
                  </div>
                  <p className="text-xs font-bold text-gray-400 animate-pulse">
                    {isEditMode ? 'Imagen 3 正在修图…' : 'Imagen 3 正在生图…'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 py-4 text-gray-300">
                <i className="fa-regular fa-image text-xl" />
                <p className="text-[11px] font-medium">
                  {isEditMode ? '修改结果将插入画布' : '生成预览将在此显示'}
                </p>
              </div>
            )}
          </div>

          {/* 翻译提示（中文 prompt 时显示实际发给 Imagen 的英文） */}
          {translatedPrompt && !isLoading && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-2xl text-blue-600 animate-in fade-in">
              <i className="fa-solid fa-language text-xs mt-0.5 shrink-0" />
              <p className="text-[11px] font-medium leading-relaxed">
                <span className="font-bold">已翻译为：</span>{translatedPrompt}
              </p>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl text-red-600 animate-in fade-in slide-in-from-top-1">
              <i className="fa-solid fa-circle-exclamation text-sm mt-0.5 shrink-0" />
              <p className="text-xs font-medium leading-relaxed">{error}</p>
            </div>
          )}

          {/* 生成/改图按钮 */}
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
                {isEditMode ? '修图中，请稍候…' : '生成中，请稍候…'}
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <i className={`fa-solid ${isEditMode ? 'fa-pen-to-square' : 'fa-wand-magic-sparkles'}`} />
                {isEditMode ? '开始改图' : '生成图片'}
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
