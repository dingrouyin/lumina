import React, { useState, useRef, useEffect } from 'react';
import { useImageGeneration } from '../hooks/useImageGeneration';

interface AIImagePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertImage: (dataUrl: string, width: number, height: number, sourceResolution?: { width: number; height: number }) => void;
  // 批量换道具：每生成一张变体结果就调用一次，variantIndex 是它在变体列表里的顺序（0-based），用于在画布上错开摆放
  onInsertBatchImage: (dataUrl: string, width: number, height: number, variantIndex: number, sourceResolution?: { width: number; height: number }) => void;
  onShowToast: (msg: string) => void;
  selectedImageDataUrls?: string[]; // 若已选中/连线画布图片（最多 4 张），传入其 data URL 列表；批量模式下第一张=底图，其余=变体
}

const ASPECT_RATIOS = [
  { label: '1:1', value: '1:1', w: 512, h: 512 },
  { label: '16:9', value: '16:9', w: 640, h: 360 },
  { label: '9:16', value: '9:16', w: 360, h: 640 },
  { label: '4:3', value: '4:3', w: 512, h: 384 },
] as const;

const MODEL_OPTIONS = [
  { label: 'Gemini 2.5 Flash', value: 'google/gemini-2.5-flash-image', hint: '约 $0.04/张，速度快，最大约1024×1024' },
  { label: 'Seedream 4.5', value: 'bytedance-seed/seedream-4.5', hint: '约 $0.04/张，最大支持4K' },
  { label: 'Nano Banana 2 Lite', value: 'google/gemini-3.1-flash-lite-image', hint: '同Gemini家族，价格与默认模型相近' },
  { label: 'FLUX.2 Klein 4B', value: 'black-forest-labs/flux.2-klein-4b', hint: '约 $0.014/张，最便宜，适合调试阶段' },
  { label: 'GPT Image 2', value: 'openai/gpt-image-2', hint: '价格较高，图内文字渲染更强，适合特定场景' },
] as const;

// 各模型支持的输出分辨率档位（查 OpenRouter /api/v1/images/models 的 supported_parameters 得来）。
// 目前只有 Seedream 4.5 支持显式指定分辨率，其余模型没有该参数，不在此列出即代表不支持
const MODEL_RESOLUTIONS: Record<string, readonly string[]> = {
  'bytedance-seed/seedream-4.5': ['1K', '2K', '4K'],
};

// 各模型能接受的最大参考图张数（查 OpenRouter /api/v1/images/models 的 input_references 字段得来）。
// 画布连线最多让你关联 4 张，但 Gemini 2.5 Flash Image 这个默认模型实际只吃 3 张，超过了要么切模型要么减图
const MODEL_MAX_REFERENCE_IMAGES: Record<string, number> = {
  'google/gemini-2.5-flash-image': 3,
  'bytedance-seed/seedream-4.5': 4,
  'google/gemini-3.1-flash-lite-image': 4,
  'black-forest-labs/flux.2-klein-4b': 4,
  'openai/gpt-image-2': 4,
};

const EDIT_MODES = [
  {
    value: 'EDIT_MODE_DEFAULT',
    label: '自由改图',
    icon: 'fa-pen-to-square',
    hint: '描述你想对这张图做什么，例如：把天空改成夕阳，让人物戴上帽子…',
  },
  {
    value: 'EDIT_MODE_BGSWAP',
    label: '更换场景',
    icon: 'fa-image',
    hint: '描述新场景，会自动匹配光影融入主体，例如：a tropical beach with palm trees，北欧风简约办公室…',
  },
  {
    value: 'EDIT_MODE_PRODUCT_IMAGE',
    label: '产品主体',
    icon: 'fa-cube',
    hint: '描述想要的观察视角，用于补齐缺失机位，例如：正视图、俯视图、45度侧面、背面视角…',
  },
] as const;

// 产品主体模式的预设视角——点击后填入指令文本框，而不是直接发送
// 参考了 Google Flow「镜头探索器」的 chip 交互思路，措辞适配我们自己的 EDIT_MODE_PRODUCT_IMAGE 模板
const PRODUCT_ANGLE_CHIPS = [
  { id: 'front', emoji: '🧭', label: '正视图', defaultPrompt: '正视图，镜头与产品正面水平对齐' },
  { id: 'top', emoji: '🦅', label: '俯视图', defaultPrompt: '俯视图，从正上方垂直向下拍摄' },
  { id: 'side', emoji: '📐', label: '侧视图', defaultPrompt: '侧视图，从产品正侧方拍摄' },
  { id: 'back', emoji: '🔄', label: '背面视角', defaultPrompt: '背面视角，展示产品背部细节' },
  { id: 'three-quarter', emoji: '↗️', label: '45度侧面', defaultPrompt: '45度侧前方视角，兼顾正面与侧面细节' },
  { id: 'detail', emoji: '🔍', label: '特写细节', defaultPrompt: '极致特写，放大展示产品材质和工艺细节' },
  { id: 'low-angle', emoji: '🐸', label: '仰视图', defaultPrompt: '仰视图，镜头从产品下方向上拍摄' },
] as const;

const MAX_PROMPT_LENGTH = 500;

// 从实际返回的像素尺寸估算档位标签，不直接回显请求时传的 resolution 参数——
// 模型不一定照办请求的档位，这里按长边阈值换算更贴近真实结果
function formatResolutionTier(width: number, height: number): string {
  const longSide = Math.max(width, height);
  if (longSide >= 3000) return '（约4K）';
  if (longSide >= 1500) return '（约2K）';
  return '（约1K）';
}

const AIImagePanel: React.FC<AIImagePanelProps> = ({
  isOpen,
  onClose,
  onInsertImage,
  onInsertBatchImage,
  onShowToast,
  selectedImageDataUrls,
}) => {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [editMode, setEditMode] = useState<string>('EDIT_MODE_DEFAULT');
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].value);
  const [resolution, setResolution] = useState<string>('1K');
  // 面板默认停靠在底部居中，拖拽只是叠加一个像素偏移量，不改变原有的定位方式
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { generate, generateBatch, isLoading, batchProgress, error, translatedPrompt, usedModel, clearError } = useImageGeneration();
  // isLoading 只在单次 generate() 调用期间为 true，批量模式下每次循环之间会短暂回落，
  // 所以面板整体的"忙碌"状态要再叠加 batchProgress，避免批量跑到一半时其他控件又能点
  const isBusy = isLoading || batchProgress !== null;

  const handleDragPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest('button')) return; // 关闭按钮保持可点击，不进入拖动
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = { startX: e.clientX, startY: e.clientY, originX: dragOffset.x, originY: dragOffset.y };
  };

  const handleDragPointerMove = (e: React.PointerEvent) => {
    if (!dragStateRef.current) return;
    const { startX, startY, originX, originY } = dragStateRef.current;
    setDragOffset({ x: originX + (e.clientX - startX), y: originY + (e.clientY - startY) });
  };

  const handleDragPointerUp = (e: React.PointerEvent) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const referenceImages = selectedImageDataUrls || [];
  const isEditMode = referenceImages.length > 0;
  const isMultiRef = referenceImages.length > 1;
  const resolutionOptions = MODEL_RESOLUTIONS[model];
  const maxRefsForModel = MODEL_MAX_REFERENCE_IMAGES[model] ?? 3;
  const exceedsModelRefLimit = referenceImages.length > maxRefsForModel;

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
    if (isOpen) {
      setPrompt('');
      clearError();
      setDragOffset({ x: 0, y: 0 }); // 每次重新打开都回到默认停靠位置，避免上次拖丢在屏幕外
    }
  }, [isOpen, clearError]);

  // 切换到文生图模式时重置 editMode
  useEffect(() => {
    if (!isEditMode) setEditMode('EDIT_MODE_DEFAULT');
  }, [isEditMode]);

  const handleGenerate = async () => {
    if (!prompt.trim() || isLoading || exceedsModelRefLimit) return;
    clearError();

    const result = await generate(
      prompt,
      isEditMode ? '1:1' : aspectRatio,
      isEditMode ? referenceImages : undefined,
      isEditMode ? editMode : undefined,
      model,
      resolutionOptions ? resolution : undefined,
    );

    if (result) {
      const selected = ASPECT_RATIOS.find(r => r.value === aspectRatio) || ASPECT_RATIOS[0];
      const sourceResolution = result.width && result.height ? { width: result.width, height: result.height } : undefined;
      onInsertImage(result.dataUrl, selected.w, selected.h, sourceResolution);
      const modelLabel = MODEL_OPTIONS.find(m => m.value === model)?.label || model;
      const sizeLabel = result.width && result.height
        ? `，${result.width}×${result.height}${formatResolutionTier(result.width, result.height)}`
        : '';
      onShowToast(`✨ ${isEditMode ? '图片已编辑并插入画布' : '图片已生成并插入画布'}（模型：${modelLabel}${sizeLabel}）`);
      onClose();
    }
  };

  // 批量换道具：referenceImages[0] 是底图，其余每张分别和底图配对跑一次现有的双图参考生成，
  // 不做失败重试——某一张失败就停在那一张，已经成功插入画布的结果保留，不回滚
  const handleBatchGenerate = async () => {
    if (!prompt.trim() || isBusy || referenceImages.length < 2) return;
    clearError();

    const [baseImage, ...variants] = referenceImages;
    const oneToOne = ASPECT_RATIOS.find(r => r.value === '1:1') || ASPECT_RATIOS[0];
    const { results, failedAt } = await generateBatch(
      prompt,
      baseImage,
      variants,
      editMode,
      model,
      resolutionOptions ? resolution : undefined,
    );

    results.forEach((result, i) => {
      const sourceResolution = result.width && result.height ? { width: result.width, height: result.height } : undefined;
      onInsertBatchImage(result.dataUrl, oneToOne.w, oneToOne.h, i, sourceResolution);
    });

    if (failedAt !== null) {
      onShowToast(`❌ 批量生成在第 ${failedAt + 1} 张（共 ${variants.length} 张）时失败，已停止；前面 ${results.length} 张已插入画布`);
    } else {
      onShowToast(`✨ 批量生成完成，共 ${results.length} 张变体已插入画布`);
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
        className="fixed bottom-24 left-1/2 z-[9999] w-[440px] bg-white/95 dark:bg-gray-900/95 backdrop-blur-2xl rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] border border-white/60 dark:border-gray-700/60 overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200"
        style={{ transform: `translate(calc(-50% + ${dragOffset.x}px), ${dragOffset.y}px)` }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* 标题栏——可拖拽移动面板位置 */}
        <div
          className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-800 cursor-move touch-none select-none"
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={handleDragPointerUp}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-md shadow-violet-200">
              <i className={`fa-solid ${isEditMode ? 'fa-pen-to-square' : 'fa-wand-magic-sparkles'} text-white text-xs`} />
            </div>
            <div>
              <h3 className="text-sm font-black text-gray-800 dark:text-gray-100 tracking-tight">
                {isEditMode ? 'AI 改图' : 'AI 生图'}
              </h3>
              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
                Powered by {MODEL_OPTIONS.find(m => m.value === model)?.label || model}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 dark:text-gray-500 hover:text-gray-600 transition-colors"
          >
            <i className="fa-solid fa-xmark text-sm" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 模型选择 */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">模型</label>
            <div className="flex flex-wrap gap-2">
              {MODEL_OPTIONS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => { setModel(m.value); clearError(); }}
                  disabled={isBusy}
                  title={m.hint}
                  className={`py-2 px-2.5 rounded-xl text-xs font-bold transition-all border ${
                    model === m.value
                      ? 'bg-violet-600 dark:bg-violet-600 border-violet-600 dark:border-violet-500 text-white shadow-md shadow-violet-200'
                      : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-violet-300 hover:text-violet-600'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 分辨率选择——只有支持该参数的模型才显示（目前仅 Seedream 4.5） */}
          {resolutionOptions && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">分辨率</label>
              <div className="flex gap-2">
                {resolutionOptions.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setResolution(r)}
                    disabled={isBusy}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all border ${
                      resolution === r
                        ? 'bg-violet-600 dark:bg-violet-600 border-violet-600 dark:border-violet-500 text-white shadow-md shadow-violet-200'
                        : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-violet-300 hover:text-violet-600'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 编辑模式：原图预览 + 编辑类型 */}
          {isEditMode && (
            <div className="space-y-3">
              {/* 原图缩略图（支持多张，标注图1/图2以便在指令里指代） */}
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-800">
                <div className="flex gap-2 shrink-0">
                  {referenceImages.map((url, idx) => (
                    <div key={idx} className="relative">
                      <img
                        src={url}
                        alt={`图${idx + 1}`}
                        className="w-12 h-12 rounded-xl object-cover border border-gray-200 dark:border-gray-700"
                      />
                      {isMultiRef && (
                        <span className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-violet-600 dark:bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-600 dark:text-gray-300">
                    {isMultiRef ? `已选中 ${referenceImages.length} 张图片` : '当前选中图片'}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {isMultiRef ? '在下方指令里用"图1""图2"…依次指代对应的图，例如"把图1的产品放入图2的场景中"；批量生成时图1是底图，其余是要分别换上的道具变体' : 'AI 将在此图基础上进行修改'}
                  </p>
                </div>
              </div>

              {/* 超出当前模型能接受的参考图上限时提醒——不同模型上限不一样，画布上连的图可能比这个模型能吃的还多 */}
              {exceedsModelRefLimit && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-orange-50 dark:bg-orange-950/40 border border-orange-100 dark:border-orange-900/50 rounded-2xl text-orange-600 dark:text-orange-400 animate-in fade-in">
                  <i className="fa-solid fa-triangle-exclamation text-xs mt-0.5 shrink-0" />
                  <p className="text-[11px] font-medium leading-relaxed">
                    当前模型「{MODEL_OPTIONS.find(m => m.value === model)?.label || model}」最多支持 {maxRefsForModel} 张参考图，你关联了 {referenceImages.length} 张，请切换模型或减少参考图后再生成
                  </p>
                </div>
              )}

              {/* 编辑类型选择 */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">编辑方式</label>
                <div className="flex gap-2">
                  {EDIT_MODES.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => { setEditMode(m.value); clearError(); }}
                      disabled={isBusy}
                      className={`flex-1 py-2 px-1 rounded-xl text-[11px] font-bold transition-all border flex flex-col items-center gap-1 ${
                        editMode === m.value
                          ? 'bg-violet-600 dark:bg-violet-600 border-violet-600 dark:border-violet-500 text-white shadow-md shadow-violet-200'
                          : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-violet-300 hover:text-violet-600'
                      }`}
                    >
                      <i className={`fa-solid ${m.icon} text-xs`} />
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 产品主体模式：预设视角，点击填入指令文本框 */}
              {editMode === 'EDIT_MODE_PRODUCT_IMAGE' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">预设视角</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRODUCT_ANGLE_CHIPS.map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => { setPrompt(chip.defaultPrompt); clearError(); textareaRef.current?.focus(); }}
                        disabled={isBusy}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-violet-300 hover:text-violet-600 transition-all disabled:opacity-40"
                      >
                        <span>{chip.emoji}</span>
                        <span>{chip.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Prompt 输入 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                {isEditMode ? '修改指令' : 'Prompt 描述'}
              </label>
              <span className={`text-[10px] font-mono font-bold transition-colors ${prompt.length > MAX_PROMPT_LENGTH * 0.9 ? 'text-orange-500' : 'text-gray-300 dark:text-gray-600'}`}>
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
              className="w-full h-[90px] resize-none bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-3 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400 transition-all font-medium leading-relaxed"
              disabled={isLoading}
            />
          </div>

          {/* 文生图：比例选择 */}
          {!isEditMode && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">图片比例</label>
              <div className="flex gap-2">
                {ASPECT_RATIOS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setAspectRatio(r.value)}
                    disabled={isBusy}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all border ${
                      aspectRatio === r.value
                        ? 'bg-violet-600 dark:bg-violet-600 border-violet-600 dark:border-violet-500 text-white shadow-md shadow-violet-200'
                        : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-violet-300 hover:text-violet-600'
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
            className="w-full rounded-2xl overflow-hidden bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-800 flex items-center justify-center"
            style={isEditMode ? { height: 80 } : { aspectRatio: `${selectedRatio.w / selectedRatio.h}`, maxHeight: 160 }}
          >
            {(isLoading || batchProgress) ? (
              <div className="w-full h-full relative overflow-hidden bg-gray-100 dark:bg-gray-800">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-400 flex items-center justify-center shadow-lg animate-pulse">
                    <i className="fa-solid fa-paintbrush text-white text-xs" />
                  </div>
                  <p className="text-xs font-bold text-gray-400 dark:text-gray-500 animate-pulse">
                    {batchProgress
                      ? `批量生成中 ${batchProgress.current}/${batchProgress.total}`
                      : `${(MODEL_OPTIONS.find(m => m.value === model)?.label || model)}${isEditMode ? ' 正在修图…' : ' 正在生图…'}`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 py-4 text-gray-300 dark:text-gray-600">
                <i className="fa-regular fa-image text-xl" />
                <p className="text-[11px] font-medium">
                  {isEditMode ? '修改结果将插入画布' : '生成预览将在此显示'}
                </p>
              </div>
            )}
          </div>

          {/* 翻译提示（中文 prompt 时显示实际发给模型的英文） */}
          {translatedPrompt && !isLoading && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 rounded-2xl text-blue-600 dark:text-blue-400 animate-in fade-in">
              <i className="fa-solid fa-language text-xs mt-0.5 shrink-0" />
              <p className="text-[11px] font-medium leading-relaxed">
                <span className="font-bold">已翻译为：</span>{translatedPrompt}
              </p>
            </div>
          )}

          {/* 实际使用的模型（确认调用的是哪个） */}
          {usedModel && !isLoading && !error && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-violet-50 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-900/50 rounded-2xl text-violet-600 dark:text-violet-400 animate-in fade-in">
              <i className="fa-solid fa-microchip text-xs mt-0.5 shrink-0" />
              <p className="text-[11px] font-medium leading-relaxed">
                <span className="font-bold">本次使用模型：</span>{MODEL_OPTIONS.find(m => m.value === usedModel)?.label || usedModel}
              </p>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2.5 px-4 py-3 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 rounded-2xl text-red-600 dark:text-red-400 animate-in fade-in slide-in-from-top-1">
              <i className="fa-solid fa-circle-exclamation text-sm mt-0.5 shrink-0" />
              <p className="text-xs font-medium leading-relaxed">{error}</p>
            </div>
          )}

          {/* 生成/改图按钮 + 批量换道具按钮（选中≥2张图时才出现，第一张=底图，其余=变体） */}
          <div className={isMultiRef ? 'flex gap-2' : ''}>
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || isBusy || exceedsModelRefLimit}
              className={`${isMultiRef ? 'flex-1' : 'w-full'} py-3.5 rounded-2xl font-black text-sm tracking-tight transition-all ${
                !prompt.trim() || isBusy || exceedsModelRefLimit
                  ? 'bg-gray-100 dark:bg-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed'
                  : 'bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white shadow-lg shadow-violet-200 hover:shadow-xl hover:shadow-violet-300 hover:scale-[1.01] active:scale-[0.99]'
              }`}
            >
              {isLoading && !batchProgress ? (
                <span className="flex items-center justify-center gap-2">
                  <i className="fa-solid fa-spinner fa-spin" />
                  {isEditMode ? '修图中，请稍候…' : '生成中，请稍候…'}
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <i className={`fa-solid ${isEditMode ? 'fa-pen-to-square' : 'fa-wand-magic-sparkles'}`} />
                  {isEditMode ? '开始改图' : '生成图片'}
                  {!isMultiRef && <span className="text-[10px] opacity-60 font-medium">Ctrl+Enter</span>}
                </span>
              )}
            </button>
            {isMultiRef && (
              <button
                onClick={handleBatchGenerate}
                disabled={!prompt.trim() || isBusy}
                title="第一张选中的图作为底图，其余每张分别和底图配一次图生成，指令共用同一段"
                className={`flex-1 py-3.5 rounded-2xl font-black text-sm tracking-tight transition-all border-2 ${
                  !prompt.trim() || isBusy
                    ? 'bg-gray-100 dark:bg-gray-800 border-transparent text-gray-300 dark:text-gray-600 cursor-not-allowed'
                    : 'bg-white dark:bg-gray-900 border-violet-500 dark:border-violet-500 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/40 active:scale-[0.99]'
                }`}
              >
                {batchProgress ? (
                  <span className="flex items-center justify-center gap-2">
                    <i className="fa-solid fa-spinner fa-spin" />
                    生成中 {batchProgress.current}/{batchProgress.total}
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <i className="fa-solid fa-layer-group" />
                    批量生成（{referenceImages.length - 1}张）
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default AIImagePanel;
