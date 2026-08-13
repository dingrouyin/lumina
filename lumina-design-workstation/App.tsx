import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { CanvasElement, Message, Rect, AlignmentGuide, ToolMode } from './types';
import CanvasElementComp from './components/CanvasElement';
import LayerPanel from './components/LayerPanel';
import TypographyPanel from './components/TypographyPanel';
import RightDock from './components/RightDock';
import AIImagePanel from './components/AIImagePanel';
import { getAIResponse, analyzeImageRegion } from './services/geminiService';
import html2canvas from 'html2canvas';
import ReactMarkdown from 'react-markdown';

const MAX_RIGHT_WIDTH = 600;
const MIN_ELEMENT_SIZE = 20;
const SNAP_THRESHOLD = 5;
const STORAGE_KEY = 'lumina-canvas-data';
const MIN_RIGHT_WIDTH = 250;

// 按长边估算档位标签，用于展示 AI 生图的真实输出分辨率
function formatResolutionTier(width: number, height: number): string {
  const longSide = Math.max(width, height);
  if (longSide >= 3000) return '约4K';
  if (longSide >= 1500) return '约2K';
  return '约1K';
}

const App: React.FC = () => {
  // --- Core State ---
  const [elements, setElements] = useState<CanvasElement[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];
      const parsed: CanvasElement[] = JSON.parse(saved);
      // #1/#11: 一次性清理残留的 UUID 命名的孤立图层（不再删除涂鸦路径）
      const cleanupDone = localStorage.getItem('lumina-cleanup-v2');
      if (!cleanupDone) {
        const cleaned = parsed.filter(el => {
          // 移除名称为 UUID 格式的孤立元素
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(el.name)) return false;
          return true;
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
        localStorage.setItem('lumina-cleanup-v2', '1');
        return cleaned;
      }
      return parsed;
    } catch (e) {
      console.error("Lumina: Failed to restore canvas data", e);
      return [];
    }
  });

  // --- Active Color (must be declared before Undo/Redo which references it) ---
  const [activeColor, setActiveColor] = useState('#000000');
  const activeColorRef = useRef('#000000');
  useEffect(() => { activeColorRef.current = activeColor; }, [activeColor]);

  // --- Undo/Redo System ---
  const [past, setPast] = useState<{ elements: CanvasElement[], color: string }[]>([]);
  const [future, setFuture] = useState<{ elements: CanvasElement[], color: string }[]>([]);
  const pastRef = useRef<{ elements: CanvasElement[], color: string }[]>([]);
  const futureRef = useRef<{ elements: CanvasElement[], color: string }[]>([]);
  useEffect(() => { pastRef.current = past; }, [past]);
  useEffect(() => { futureRef.current = future; }, [future]);

  const deepClone = useCallback((els: CanvasElement[]) => {
    return els.map(el => ({ ...el, points: el.points ? [...el.points.map(p => ({ x: p.x, y: p.y, pressure: p.pressure }))] : undefined }));
  }, []);

  const saveHistory = useCallback((currentElements: CanvasElement[]) => {
    const clonedElements = deepClone(currentElements);
    setPast(prev => [...prev, { elements: clonedElements, color: activeColorRef.current }]);
    setFuture([]); // Clear future on new action
  }, [deepClone]);

  const undo = useCallback(() => {
    const currentPast = pastRef.current;
    if (currentPast.length === 0) return;
    dragRef.current = null;

    const snapshot = currentPast[currentPast.length - 1];
    // 将当前状态压入 future
    const clonedCurrent = deepClone(elementsRef.current);
    setFuture(prev => [{ elements: clonedCurrent, color: activeColorRef.current }, ...prev]);
    // 恢复 past 中的快照
    setElements(deepClone(snapshot.elements));
    setActiveColor(snapshot.color);
    setPast(currentPast.slice(0, -1));
    setSelectedIds([]);
    setEditingId(null);
  }, [deepClone]);

  const redo = useCallback(() => {
    const currentFuture = futureRef.current;
    if (currentFuture.length === 0) return;
    dragRef.current = null;

    const snapshot = currentFuture[0];
    // 将当前状态压入 past
    const clonedCurrent = deepClone(elementsRef.current);
    setPast(prev => [...prev, { elements: clonedCurrent, color: activeColorRef.current }]);
    // 恢复 future 中的快照
    setElements(deepClone(snapshot.elements));
    setActiveColor(snapshot.color);
    setFuture(currentFuture.slice(1));
    setSelectedIds([]);
    setEditingId(null);
  }, [deepClone]);

  const [dockedPanels, setDockedPanels] = useState<string[]>(['layers', 'typography']);
  const [activeDrawer, setActiveDrawer] = useState<'layers' | 'typography' | null>(null);
  // Removed dockPosition - RightDock is now a static sidebar
  const [dragHandOff, setDragHandOff] = useState<{ id: string, startX: number, startY: number, pointerId: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, targetId?: string } | null>(null);

  // Bug 7: IME Composing state reference
  const isComposingRef = useRef(false);

  // Bug 11 Fix & Escape Menu Fix
  useEffect(() => {
    setSelectedIds(prev => {
      const valid = prev.filter(id => elements.some(el => el.id === id));
      return valid.length !== prev.length ? valid : prev;
    });
  }, [elements]);

  // Global Keydown (Escape for context menu)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setExportModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleDetach = useCallback((panelId: 'layers' | 'typography', startX?: number, startY?: number, pointerId?: number) => {
    setDockedPanels(prev => prev.filter(p => p !== panelId));
    setActiveDrawer(null);
    if (startX !== undefined && startY !== undefined && pointerId !== undefined) {
      setDragHandOff({ id: panelId, startX, startY, pointerId });
    }
  }, []);

  const handleDock = useCallback((panelId: 'layers' | 'typography') => {
    setDockedPanels(prev => [...new Set([...prev, panelId])]);
  }, []);

  // --- Layout & Drag State ---
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [isExternalDragging, setIsExternalDragging] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  // --- AI 生图面板状态 ---
  const [showAIImagePanel, setShowAIImagePanel] = useState(false);
  // 打开面板时快照选中图片 URL 列表（最多 2 张，防止打开时事件冒泡导致选区丢失）
  const [aiEditImageDataUrls, setAiEditImageDataUrls] = useState<string[]>([]);


  // --- Tool State ---
  // Bug #12 Fix: 确保初始和刷新后始终是 select 模式
  const [toolMode, setToolMode] = useState<ToolMode>('select');

  // Bug #12: 挂载时强制重置工具模式，防止 React Fast Refresh 等保留旧状态
  useEffect(() => {
    setToolMode('select');
    setCurrentPoints([]);
  }, []);

  // --- Pen Tool State ---
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number; pressure?: number }[]>([]);
  const [brushSize, setBrushSize] = useState(5);
  // pointsBufferRef: 实时收集所有指针事件的采样点（不经 rAF 节流），解决笔触不连贯问题
  const pointsBufferRef = useRef<{ x: number; y: number; pressure?: number }[]>([]);
  // activeColor is declared above (before undo/redo) to avoid TDZ crash

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setActiveColor(newColor);

    if (selectedIdsRef.current.length > 0) {
      saveHistory(elementsRef.current);
      setElements(prev => prev.map(el => {
        if (selectedIdsRef.current.includes(el.id)) {
          return { ...el, color: newColor, strokeColor: newColor };
        }
        return el;
      }));
    }
  }, [saveHistory]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIdsRef.current.length === 0) return;
    saveHistory(elementsRef.current);
    setElements(prev => prev.filter(el => !selectedIdsRef.current.includes(el.id)));
    setSelectedIds([]);
  }, [saveHistory]);

  // #6/#7: 图层面板单个图层删除
  const handleDeleteElement = useCallback((id: string) => {
    saveHistory(elementsRef.current);
    setElements(prev => prev.filter(el => el.id !== id));
    setSelectedIds(prev => prev.filter(sid => sid !== id));
  }, [saveHistory]);

  // --- Persistence Logic ---
  // Bug #11 Fix: 持久化增加 try/catch 处理 QuotaExceededError
  // 优化：图片 base64 体积太大，保存时剥离 content，只保留布局信息
  // 图片内容仅存在内存中，刷新后图片会消失但布局（位置/大小/图层）保留
  const saveToLocalStorage = useCallback(() => {
    try {
      const dataToSave = elementsRef.current.map(el => {
        if (el.type === 'image') {
          return { ...el, content: '' }; // 剥离 base64，只保留位置和大小
        }
        return el;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (e) {
      console.error('Lumina: localStorage 写入失败', e);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(saveToLocalStorage, 300);
    return () => clearTimeout(timer);
  }, [elements, saveToLocalStorage]);

  // Bug #11 Fix: 页面关闭/刷新前立即保存，防止 debounce 期间刷新丢失数据
  useEffect(() => {
    const handleBeforeUnload = () => saveToLocalStorage();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveToLocalStorage]);

  // --- Right Panel Resize Logic ---
  const startResizing = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsResizingRight(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizingRight(false);
  }, []);

  const resize = useCallback((e: PointerEvent) => {
    if (isResizingRight) {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= MIN_RIGHT_WIDTH && newWidth <= MAX_RIGHT_WIDTH) {
        setRightPanelWidth(newWidth);
      }
    }
  }, [isResizingRight]);

  useEffect(() => {
    if (isResizingRight) {
      window.addEventListener('pointermove', resize);
      window.addEventListener('pointerup', stopResizing);
    } else {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResizing);
    }
    return () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResizing);
    };
  }, [isResizingRight, resize, stopResizing]);

  const elementsRef = useRef<CanvasElement[]>([]);
  const selectedIdsRef = useRef<string[]>([]);

  // 辅助函数：获取下一个可用名称，防止重名
  const getNextElementName = useCallback((baseName: string) => {
    let maxNum = 0;
    const regex = new RegExp(`^${baseName} (\\d+)$`);
    elementsRef.current.forEach(el => {
      const match = el.name?.match(regex);
      if (match) {
        maxNum = Math.max(maxNum, parseInt(match[1], 10));
      } else if (el.name === baseName) {
        maxNum = Math.max(maxNum, 1);
      }
    });
    return maxNum === 0 ? baseName : `${baseName} ${maxNum + 1}`;
  }, []);

  // 将 AI 生成的图片插入画布中央（在 getNextElementName 之后声明，避免 TDZ）
  const handleInsertAIImage = useCallback((dataUrl: string, imgW: number, imgH: number, sourceResolution?: { width: number; height: number }) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const centerX = (rect.width / 2 - offset.x) / scale;
    const centerY = (rect.height / 2 - offset.y) / scale;
    const newEl: CanvasElement = {
      id: crypto.randomUUID(),
      type: 'image',
      x: centerX - imgW / 2,
      y: centerY - imgH / 2,
      width: imgW,
      height: imgH,
      content: dataUrl,
      name: getNextElementName('AI 生图'),
      zIndex: Math.max(0, ...elementsRef.current.map(e => e.zIndex)) + 1,
      sourceResolution,
    };
    saveHistory(elementsRef.current);
    setElements(prev => [...prev, newEl]);
    setSelectedIds([newEl.id]);
    setShowAIImagePanel(false);
  }, [offset, scale, getNextElementName, saveHistory]);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    isPanning: boolean;
    isDragging: boolean;
    isResizing: boolean;
    resizeDir: string | null;
    initialElements: CanvasElement[];
    initialShift: boolean;
  } | null>(null);
  const frameRequested = useRef(false);

  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const isSpacePressedRef = useRef(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const isShiftPressedRef = useRef(false);
  const [selectionBox, setSelectionBox] = useState<Rect | null>(null);
  const selectionStartRef = useRef<{ x: number, y: number } | null>(null);

  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: "Lumina 已就绪。当前状态：\n- 触控优化: 已启用指针事件，支持 Wacom 等手写笔流畅操作。 \n- 智能导出: 选中元素后导出将仅包含已选内容；无选中时导出全图。 \n- 组合移动: 选中多个元素后，拖拽其中一个即可同步移动。", timestamp: new Date() }
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingSeconds, setTypingSeconds] = useState(0);
  const [isLoading, setIsLoading] = useState(false); // Loading state for AI operations
  const [isExporting, setIsExporting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Bug #5: 缩放输入框本地状态
  const [zoomInputValue, setZoomInputValue] = useState('');
  const [isZoomFocused, setIsZoomFocused] = useState(false);

  // Sync activeColor with selected element (Bug #7 fix)
  useEffect(() => {
    if (selectedIds.length === 1) {
      const el = elements.find(e => e.id === selectedIds[0]);
      if (el) {
        if (el.type === 'path' && el.strokeColor) setActiveColor(el.strokeColor);
        else if (el.type === 'text' && el.color) setActiveColor(el.color);
      }
    }
  }, [selectedIds, elements]);

  // #8: AI 等待计时器
  useEffect(() => {
    if (!isTyping) { setTypingSeconds(0); return; }
    const interval = setInterval(() => setTypingSeconds(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isTyping]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasContentRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const magicStartImageRef = useRef<CanvasElement | null>(null);

  const screenToCanvas = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - offset.x) / scale,
      y: (clientY - rect.top - offset.y) / scale
    };
  };

  // --- Keyboard Handling ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. 防冲突安全阀 (Active Element Guard)
      const activeEl = document.activeElement;
      const isInput = activeEl?.tagName === 'TEXTAREA' || activeEl?.tagName === 'INPUT' || activeEl?.getAttribute('contenteditable') === 'true';

      if (e.code === 'Space' && !isInput) { setIsSpacePressed(true); isSpacePressedRef.current = true; }
      if (e.key === 'Shift') { setIsShiftPressed(true); isShiftPressedRef.current = true; }

      // 如果正在输入文字，则拒绝后续所有全局视图快捷键的拦截
      if (isInput) return;

      // 2. 核心 PS 快捷键中枢 (Photoshop Keys)
      switch (e.key.toLowerCase()) {
        case 'v':
          setToolMode('select');
          setCurrentPoints([]);
          dragRef.current = null;
          setSelectionBox(null);
          setGuides([]);
          break;
        case 'b':
          setToolMode('draw');
          setCurrentPoints([]);
          dragRef.current = null;
          setSelectionBox(null);
          setGuides([]);
          break;
        case 't':
          addTextCard();
          break;
        case '[':
          setBrushSize(prev => Math.max(1, prev - 2));
          break;
        case ']':
          setBrushSize(prev => Math.min(50, prev + 2));
          break;
        // Undo / Redo (macOS / Windows 通用)
        case 'z':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) redo(); else undo();
          }
          break;
        case 'y':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            redo();
          }
          break;
        case 'a':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (elementsRef.current.length > 0) {
              setToolMode('select');
              setCurrentPoints([]);
              setSelectionBox(null);
              setSelectedIds(elementsRef.current.map(el => el.id));
            }
          }
          break;
      }

      // Delete
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdsRef.current.length > 0) {
        saveHistory(elementsRef.current);
        setElements(prev => prev.filter(el => !selectedIdsRef.current.includes(el.id)));
        setSelectedIds([]);
      }

      // Zoom
      if ((e.ctrlKey || e.metaKey)) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); setScale(s => Math.min(s + 0.2, 5)); }
        if (e.key === '-') { e.preventDefault(); setScale(s => Math.max(s - 0.2, 0.1)); }
        if (e.key === '0') { e.preventDefault(); setScale(1); setOffset({ x: 0, y: 0 }); }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') { setIsSpacePressed(false); isSpacePressedRef.current = false; }
      if (e.key === 'Shift') { setIsShiftPressed(false); isShiftPressedRef.current = false; }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener('pointerdown', handleGlobalClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('pointerdown', handleGlobalClick);
    };
  }, [undo, redo, saveHistory]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (editingId) return;

    // 防止工具栏/面板内的点击触发画布绘图或框选逻辑
    const target = e.target as HTMLElement;
    if (target.closest('.floating-toolbar') || target.closest('.layer-panel-root') || target.closest('.typography-panel-root')) return;

    const isMiddleClick = e.button === 1;
    const isLeftClick = e.button === 0;

    // Bug #4 Fix: Pan(抓手) 检查优先于 draw，在任何工具模式下空格+左键或中键都进入平移
    // Bug #4 Fix (v2): 用 isSpacePressedRef 替代 isSpacePressed state，避免闭包读到旧值
    if (isMiddleClick || (isLeftClick && isSpacePressedRef.current)) {
      dragRef.current = {
        startX: e.clientX, startY: e.clientY,
        lastX: e.clientX, lastY: e.clientY,
        isPanning: true, isDragging: false, isResizing: false,
        resizeDir: null, initialElements: elementsRef.current, initialShift: false
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (toolMode === 'draw') {
      const pos = screenToCanvas(e.clientX, e.clientY);
      const firstPoint = { x: pos.x, y: pos.y, pressure: e.pressure || 0.5 };
      pointsBufferRef.current = [firstPoint];
      setCurrentPoints([firstPoint]);
      dragRef.current = { lastX: e.clientX, lastY: e.clientY, startX: 0, startY: 0, isPanning: false, isDragging: false, isResizing: false, resizeDir: null, initialElements: elementsRef.current, initialShift: false };
      // Capture pointer for drawing
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    // 只在默认选择模式下才允许开启多框选
    if (toolMode === 'select' && (isLeftClick || e.pointerType === 'pen' || e.pointerType === 'touch')) {
      const targetEl = e.target as HTMLElement;
      const onBackground = targetEl === canvasRef.current || targetEl === canvasContentRef.current;
      // Alt + 拖拽 = 强制框选，可在元素上方发起；或点击空白画布背景时发起
      if (onBackground || e.altKey) {
        if (!e.shiftKey) setSelectedIds([]);

        selectionStartRef.current = screenToCanvas(e.clientX, e.clientY);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
    }
  };


  const updateFrame = useCallback(() => {
    if (!dragRef.current) {
      frameRequested.current = false;
      setGuides([]);
      return;
    }

    // Bug #4 Fix (v3): isPanning 检查必须在 toolMode=draw 检查之前
    // 否则 draw 模式下空格+拖拽永远进入 draw 分支，pan 逻辑永远不执行
    if (toolMode === 'draw' && !dragRef.current.isPanning) {
      const pos = screenToCanvas(dragRef.current.lastX, dragRef.current.lastY);
      setCurrentPoints(prev => [...prev, pos]);
      frameRequested.current = false;
      return;
    }

    const { lastX, lastY, startX, startY, isPanning, isDragging, isResizing, resizeDir, initialElements, initialShift } = dragRef.current;
    const dx = lastX - startX;
    const dy = lastY - startY;

    if (dx === 0 && dy === 0) {
      frameRequested.current = false;
      return;
    }

    if (isPanning) {
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      dragRef.current.startX = lastX;
      dragRef.current.startY = lastY;
    } else if (isDragging) {
      let canvasDx = dx / scale;
      let canvasDy = dy / scale;

      if (selectedIdsRef.current.length > 0) {
        const otherElements = initialElements.filter(el => !selectedIdsRef.current.includes(el.id));
        const activeElements = initialElements.filter(el => selectedIdsRef.current.includes(el.id));

        let selMinX = Infinity, selMinY = Infinity, selMaxX = -Infinity, selMaxY = -Infinity;
        activeElements.forEach(el => {
          const h = el.height || (el.type === 'image' ? 300 : 180);
          selMinX = Math.min(selMinX, el.x);
          selMinY = Math.min(selMinY, el.y);
          selMaxX = Math.max(selMaxX, el.x + el.width);
          selMaxY = Math.max(selMaxY, el.y + h);
        });

        const selWidth = selMaxX - selMinX;
        const selHeight = selMaxY - selMinY;

        const targetMinX = selMinX + canvasDx;
        const targetMinY = selMinY + canvasDy;
        const targetMaxX = targetMinX + selWidth;
        const targetMaxY = targetMinY + selHeight;
        const targetCenterX = targetMinX + selWidth / 2;
        const targetCenterY = targetMinY + selHeight / 2;

        const newGuides: AlignmentGuide[] = [];
        let snapX: number | null = null;
        let snapY: number | null = null;

        otherElements.forEach(other => {
          const oh = other.height || (other.type === 'image' ? 300 : 180);
          const oMinX = other.x, oMaxX = other.x + other.width, oCenterX = other.x + other.width / 2;
          const oMinY = other.y, oMaxY = other.y + oh, oCenterY = other.y + oh / 2;

          const checkSnapX = (targetVal: number, anchorVal: number, offsetVal: number) => {
            if (Math.abs(targetVal - anchorVal) < SNAP_THRESHOLD) {
              snapX = anchorVal - offsetVal;
              newGuides.push({ type: 'vertical', pos: anchorVal });
            }
          };
          if (snapX === null) {
            checkSnapX(targetMinX, oMinX, 0); checkSnapX(targetMinX, oMaxX, 0);
            checkSnapX(targetMaxX, oMinX, selWidth); checkSnapX(targetMaxX, oMaxX, selWidth);
            checkSnapX(targetCenterX, oCenterX, selWidth / 2);
          }
          const checkSnapY = (targetVal: number, anchorVal: number, offsetVal: number) => {
            if (Math.abs(targetVal - anchorVal) < SNAP_THRESHOLD) {
              snapY = anchorVal - offsetVal;
              newGuides.push({ type: 'horizontal', pos: anchorVal });
            }
          };
          if (snapY === null) {
            checkSnapY(targetMinY, oMinY, 0); checkSnapY(targetMinY, oMaxY, 0);
            checkSnapY(targetMaxY, oMinY, selHeight); checkSnapY(targetMaxY, oMaxY, selHeight);
            checkSnapY(targetCenterY, oCenterY, selHeight / 2);
          }
        });

        if (snapX !== null) canvasDx = snapX - selMinX;
        if (snapY !== null) canvasDy = snapY - selMinY;
        setGuides(newGuides);
      }

      setElements(initialElements.map(el => {
        if (selectedIdsRef.current.includes(el.id)) {
          return { ...el, x: el.x + canvasDx, y: el.y + canvasDy };
        }
        return el;
      }));
    } else if (isResizing && resizeDir) {
      const canvasDx = dx / scale;
      const canvasDy = dy / scale;

      setElements(initialElements.map(el => {
        if (!selectedIdsRef.current.includes(el.id)) return el;
        const initialEl = initialElements.find(i => i.id === el.id);
        if (!initialEl) return el;

        let newX = initialEl.x;
        let newY = initialEl.y;
        let newW = initialEl.width;
        let newH = initialEl.height || (initialEl.type === 'image' ? 300 : 180);

        if (resizeDir.includes('e')) newW = Math.max(MIN_ELEMENT_SIZE, initialEl.width + canvasDx);
        if (resizeDir.includes('s')) newH = Math.max(MIN_ELEMENT_SIZE, (initialEl.height || (initialEl.type === 'image' ? 300 : 180)) + canvasDy);
        if (resizeDir.includes('w')) {
          newW = Math.max(MIN_ELEMENT_SIZE, initialEl.width - canvasDx);
          if (newW > MIN_ELEMENT_SIZE) newX = initialEl.x + canvasDx;
        }
        if (resizeDir.includes('n')) {
          const baseH = initialEl.height || (initialEl.type === 'image' ? 300 : 180);
          newH = Math.max(MIN_ELEMENT_SIZE, baseH - canvasDy);
          if (newH > MIN_ELEMENT_SIZE) newY = initialEl.y + canvasDy;
        }

        if (isShiftPressed) {
          const ratio = initialEl.width / (initialEl.height || (initialEl.type === 'image' ? 300 : 180));
          if (Math.abs(canvasDx) > Math.abs(canvasDy)) {
            newH = newW / ratio;
            if (resizeDir.includes('n')) newY = initialEl.y + (initialEl.height || 0) - newH;
          } else {
            newW = newH * ratio;
            if (resizeDir.includes('w')) newX = initialEl.x + initialEl.width - newW;
          }
        }

        return { ...el, x: newX, y: newY, width: newW, height: newH };
      }));
    }

    frameRequested.current = false;
  }, [scale, isShiftPressed, toolMode, screenToCanvas]);

  const handlePointerMove = (e: React.PointerEvent) => {
    // Bug #1 Fix: 画笔模式下直接收集所有采样点到 buffer（不经 rAF 节流），避免丢点
    if (toolMode === 'draw' && dragRef.current && !dragRef.current.isPanning) {
      // 利用 getCoalescedEvents 获取浏览器合并的所有中间指针位置
      const coalescedEvents = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() || [];
      const eventsToProcess = coalescedEvents.length > 0 ? coalescedEvents : [e.nativeEvent as PointerEvent];

      for (const pe of eventsToProcess) {
        const pos = screenToCanvas(pe.clientX, pe.clientY);
        pointsBufferRef.current.push({ x: pos.x, y: pos.y, pressure: pe.pressure || 0.5 });
      }

      // 通过 rAF 批量 flush buffer 到 state 以触发预览渲染
      if (!frameRequested.current) {
        frameRequested.current = true;
        requestAnimationFrame(() => {
          setCurrentPoints([...pointsBufferRef.current]);
          frameRequested.current = false;
        });
      }
      return;
    }

    // Normal Selection & Dragging Logic
    if (selectionStartRef.current) {
      const current = screenToCanvas(e.clientX, e.clientY);
      const rect: Rect = {
        x: Math.min(selectionStartRef.current.x, current.x),
        y: Math.min(selectionStartRef.current.y, current.y),
        width: Math.abs(selectionStartRef.current.x - current.x),
        height: Math.abs(selectionStartRef.current.y - current.y)
      };
      setSelectionBox(rect);

      const newlySelected = elementsRef.current.filter(el => {
        const h = el.height || (el.type === 'image' ? 300 : 180);
        return (
          el.x < rect.x + rect.width &&
          el.x + el.width > rect.x &&
          el.y < rect.y + rect.height &&
          el.y + h > rect.y
        );
      }).map(el => el.id);
      setSelectedIds(newlySelected);
      return;
    }

    if (dragRef.current) {
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      if (!frameRequested.current) {
        frameRequested.current = true;
        requestAnimationFrame(updateFrame);
      }
    }
  };


  const handlePointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    // Bug #2 Fix: 从 pointsBufferRef 读取完整点序列，而非依赖可能滞后的 state
    if (toolMode === 'draw' && pointsBufferRef.current.length > 1) {
      saveHistory(elementsRef.current);

      const finalPoints = pointsBufferRef.current;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      finalPoints.forEach(p => {
        if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
      });

      const padding = brushSize;
      minX -= padding; minY -= padding; maxX += padding; maxY += padding;

      const adjustedPoints = finalPoints.map(p => ({ x: p.x - minX, y: p.y - minY, pressure: p.pressure }));

      const newPath: CanvasElement = {
        id: crypto.randomUUID(), type: 'path',
        x: minX, y: minY,
        width: maxX - minX, height: maxY - minY,
        content: 'path', name: getNextElementName('涂鸦'),
        zIndex: Math.max(0, ...elementsRef.current.map(e => e.zIndex)) + 1,
        points: adjustedPoints,
        strokeColor: activeColor,
        strokeWidth: brushSize
      };
      setElements(prev => [...prev, newPath]);
    }
    pointsBufferRef.current = [];
    setCurrentPoints([]);

    if (dragRef.current && (dragRef.current.isDragging || dragRef.current.isResizing)) {
      const initial = JSON.stringify(dragRef.current.initialElements);
      const current = JSON.stringify(elementsRef.current);
      if (initial !== current) {
        saveHistory(dragRef.current.initialElements);
      }
    }

    dragRef.current = null;
    selectionStartRef.current = null;
    setSelectionBox(null);
    setGuides([]);
  };


  // Figma 风格滚轮：Ctrl/Pinch → zoom-to-cursor；其余 → 双轴平移
  // 必须用 useEffect native listener + {passive: false} 才能调用 preventDefault
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const currentScale = scaleRef.current;
      const currentOffset = offsetRef.current;

      if (e.ctrlKey) {
        // Ctrl + 滚轮 / 触控板捏合 → zoom-to-cursor
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const delta = -e.deltaY;
        const zoomFactor = Math.pow(1.1, delta / 100);
        const newScale = Math.min(Math.max(currentScale * zoomFactor, 0.1), 5);
        const clampOffset = (v: number) => isNaN(v) ? 0 : Math.max(-50000, Math.min(50000, v));
        const newOffsetX = clampOffset(mouseX - (mouseX - currentOffset.x) * (newScale / currentScale));
        const newOffsetY = clampOffset(mouseY - (mouseY - currentOffset.y) * (newScale / currentScale));
        setScale(newScale);
        setOffset({ x: newOffsetX, y: newOffsetY });
      } else {
        // 普通滚轮 / 触控板双指滑动 → 双轴平移（与 Figma 一致）
        setOffset(prev => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  const handleElementSelect = useCallback((id: string, isShift: boolean) => {
    if (isShift) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    } else {
      setSelectedIds(prev => prev.includes(id) ? prev : [id]);
    }
    // 注意：不再自动置顶选中元素——图层顺序只由手动操作（上移/下移按钮）改变
  }, []);

  const handleLayerMove = useCallback((id: string, direction: 'up' | 'down') => {
    setElements(prev => {
      const idx = prev.findIndex(el => el.id === id);
      if (idx === -1) return prev;

      // 在我们的渲染逻辑中，原数组的末尾才是“最上层”(视觉最前面)
      // 所以 LayerPanel 里点击“上移 (up)” => 意思是“移向顶层”，即 Index 增加
      // 发送“下移 (down)” => 意思是“移向底层”，即 Index 减少

      if (direction === 'up' && idx < prev.length - 1) {
        const nextArr = [...prev];
        // 交换当前元素和后一个元素
        const temp = nextArr[idx];
        nextArr[idx] = nextArr[idx + 1];
        nextArr[idx + 1] = temp;
        // saveHistory
        saveHistory(prev);
        return nextArr;
      } else if (direction === 'down' && idx > 0) {
        const nextArr = [...prev];
        // 交换当前元素和前一个元素
        const temp = nextArr[idx];
        nextArr[idx] = nextArr[idx - 1];
        nextArr[idx - 1] = temp;
        // saveHistory
        saveHistory(prev);
        return nextArr;
      }
      return prev;
    });
  }, [saveHistory]);

  const handleElementDragStart = useCallback((e: React.PointerEvent, id: string) => {
    // Alt + 拖拽 = 强制框选，不启动元素移动，让事件冒泡到 canvas 触发框选
    if (e.altKey) return;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
      isPanning: false, isDragging: true, isResizing: false, resizeDir: null,
      initialElements: elementsRef.current.map(el => ({ ...el, points: el.points ? [...el.points.map(p => ({ ...p }))] : undefined })), initialShift: false
    };
  }, []);

  const handleElementResizeStart = useCallback((e: React.PointerEvent, id: string, dir: string) => {
    dragRef.current = {
      startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
      isPanning: false, isDragging: false, isResizing: true, resizeDir: dir,
      initialElements: elementsRef.current.map(el => ({ ...el, points: el.points ? [...el.points.map(p => ({ ...p }))] : undefined })), initialShift: e.shiftKey
    };
  }, []);

  const handleElementRename = useCallback((id: string, name: string) => {
    setElements(prev => prev.map(el => el.id === id ? { ...el, name } : el));
  }, []);

  const handleElementDoubleClick = useCallback((id: string) => {
    // 强制系统“放下画笔”，绝对禁止在文本上留下画笔痕迹！
    setToolMode('select');
    setEditingId(id);
  }, []);

  const handleElementUpdateContent = useCallback((id: string, content: string) => {
    setElements(prev => prev.map(el => el.id === id ? { ...el, content } : el));
  }, []);

  const handleElementFinishEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleAlign = useCallback((type: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom' | 'distribute-h' | 'distribute-v') => {
    if (selectedIdsRef.current.length < 2) return;

    saveHistory(elementsRef.current);

    setElements(prev => {
      const selectedEls = prev.filter(el => selectedIdsRef.current.includes(el.id));
      if (selectedEls.length < 2) return prev;

      // 1. Calculate Bounding Box of all selected elements
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      selectedEls.forEach(el => {
        const h = el.height || 180;
        if (el.x < minX) minX = el.x;
        if (el.y < minY) minY = el.y;
        if (el.x + el.width > maxX) maxX = el.x + el.width;
        if (el.y + h > maxY) maxY = el.y + h;
      });

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      // 2. 水平分布：按左边缘排序，均匀分配间距
      if (type === 'distribute-h') {
        if (selectedEls.length < 3) return prev;
        const sorted = [...selectedEls].sort((a, b) => a.x - b.x);
        const totalWidth = sorted.reduce((sum, el) => sum + el.width, 0);
        const gap = (maxX - minX - totalWidth) / (sorted.length - 1);
        let cursor = minX;
        const posMap: Record<string, number> = {};
        sorted.forEach(el => { posMap[el.id] = cursor; cursor += el.width + gap; });
        return prev.map(el => selectedIdsRef.current.includes(el.id) ? { ...el, x: posMap[el.id] } : el);
      }

      // 3. 垂直分布：按上边缘排序，均匀分配间距
      if (type === 'distribute-v') {
        if (selectedEls.length < 3) return prev;
        const sorted = [...selectedEls].sort((a, b) => a.y - b.y);
        const totalHeight = sorted.reduce((sum, el) => sum + (el.height || 180), 0);
        const gap = (maxY - minY - totalHeight) / (sorted.length - 1);
        let cursor = minY;
        const posMap: Record<string, number> = {};
        sorted.forEach(el => { posMap[el.id] = cursor; cursor += (el.height || 180) + gap; });
        return prev.map(el => selectedIdsRef.current.includes(el.id) ? { ...el, y: posMap[el.id] } : el);
      }

      // 4. Apply Alignment transformation
      return prev.map(el => {
        if (!selectedIdsRef.current.includes(el.id)) return el;

        let newX = el.x;
        let newY = el.y;

        switch (type) {
          case 'left': newX = minX; break;
          case 'center-h': newX = centerX - el.width / 2; break;
          case 'right': newX = maxX - el.width; break;
          case 'top': newY = minY; break;
          case 'center-v': newY = centerY - el.height / 2; break;
          case 'bottom': newY = maxY - el.height; break;
        }

        return { ...el, x: newX, y: newY };
      });
    });
  }, [saveHistory]);

  const handleTextPropertyChange = useCallback((property: 'color' | 'lineHeight' | 'letterSpacing' | 'fontSize', value: string | number) => {
    saveHistory(elementsRef.current);
    setElements(prev => prev.map(el => {
      if (el.type === 'text' && selectedIdsRef.current.includes(el.id)) {
        return { ...el, [property]: value };
      }
      return el;
    }));
  }, [saveHistory]);


  const processFiles = useCallback((files: File[], dropX?: number, dropY?: number) => {
    const images = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (images.length === 0) return;

    saveHistory(elementsRef.current);

    // Bug #6 Fix: 压缩大图以减少 base64 体积和渲染压力
    const compressImage = (dataUrl: string): Promise<string> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const MAX_PIXELS = 2000;
          // 如果图片尺寸在限制内，直接返回原始数据
          if (img.width <= MAX_PIXELS && img.height <= MAX_PIXELS) {
            resolve(dataUrl);
            return;
          }
          // 缩放到 MAX_PIXELS 内
          let w = img.width, h = img.height;
          const ratio = w / h;
          if (w > h) { w = MAX_PIXELS; h = MAX_PIXELS / ratio; }
          else { h = MAX_PIXELS; w = MAX_PIXELS * ratio; }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);
          // 使用 JPEG 压缩（质量 0.85）减少体积
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => resolve(dataUrl); // 回退到原始数据
        img.src = dataUrl;
      });
    };

    images.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const id = crypto.randomUUID();
        let pos = { x: 0, y: 0 };
        if (dropX !== undefined && dropY !== undefined) {
          pos = { x: dropX + (index * 20), y: dropY + (index * 20) };
        } else {
          const viewportCenterX = window.innerWidth / 2;
          const viewportCenterY = window.innerHeight / 2;
          pos = {
            x: (viewportCenterX - offset.x) / scale + (index * 20),
            y: (viewportCenterY - offset.y) / scale + (index * 20)
          };
        }

        const rawDataUrl = event.target?.result as string;
        const compressedDataUrl = await compressImage(rawDataUrl);

        const img = new Image();
        img.onload = () => {
          const maxDim = 400;
          let w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            const ratio = w / h;
            if (w > h) { w = maxDim; h = maxDim / ratio; }
            else { h = maxDim; w = maxDim * ratio; }
          }
          const rawName = file.name.replace(/\.[^/.]+$/, "");
          const displayName = (!rawName || rawName.length > 20 || /^[a-zA-Z0-9_-]{8,}$/.test(rawName)) ? '导入图片' : rawName;
          const el: CanvasElement = {
            id, type: 'image', x: pos.x - w / 2, y: pos.y - h / 2, width: w, height: h, content: compressedDataUrl,
            name: getNextElementName(displayName), zIndex: Math.max(0, ...elementsRef.current.map(e => e.zIndex)) + 10,
          };
          setElements(prev => [...prev, el]);
          setSelectedIds([id]);
        };
        img.src = compressedDataUrl;
      };
      reader.readAsDataURL(file);
    });
  }, [saveHistory, offset, scale]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Don't paste if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.clipboardData && e.clipboardData.files.length > 0) {
        e.preventDefault();
        processFiles(Array.from(e.clipboardData.files));
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [processFiles]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    processFiles(Array.from(e.target.files));
  };

  // Dynamic SVG Cursor for Brush Tool
  const cursorStyle = useMemo(() => {
    // Bug #4 Fix (v3): 空格键检查优先于 draw 模式的画笔光标
    // 否则 draw 模式下按住空格看不到 grab 光标，用户以为没反应
    const isPanning = dragRef.current?.isPanning || false;
    if (isSpacePressed) {
      return isPanning ? 'grabbing' : 'grab';
    }
    if (toolMode === 'draw') {
      const radius = brushSize / 2;
      const size = brushSize + 2;
      const center = radius + 1;

      const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="black" stroke-width="1" />
        <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="white" stroke-width="2" opacity="0.5" />
      </svg>`;

      return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}') ${center} ${center}, auto`;
    }
    return 'default';
  }, [toolMode, brushSize, isSpacePressed]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // BUG-01: Prevent double firing from bubbling to root div
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const pos = screenToCanvas(e.clientX, e.clientY);
      processFiles(Array.from(e.dataTransfer.files), pos.x, pos.y);
    }
  };

  const addTextCard = () => {
    saveHistory(elementsRef.current);
    const id = crypto.randomUUID();
    const el: CanvasElement = {
      id, type: 'text', x: 200, y: 200, width: 280, height: 180,
      content: "双击这里编辑文案。Lumina 已支持多选移动与组合设计。",
      name: getNextElementName("文本"), zIndex: Math.max(0, ...elementsRef.current.map(e => e.zIndex)) + 10,
    };
    setElements(prev => [...prev, el]);
    setSelectedIds([id]);
    setEditingId(id);
  };

  const handleExport = async () => {
    if (!canvasContentRef.current) {
      console.error("Export Error: canvasContentRef is null");
      return;
    }
    if (isExporting) return;
    if (elements.length === 0) {
      setToastMsg('画布为空，请先添加内容');
      setTimeout(() => setToastMsg(null), 3000);
      return;
    }

    setIsExporting(true);
    setToastMsg("图片开始导出，请稍候...");

    // Bug #8 Fix: Use a short timeout to let the UI thread render the toast before html2canvas blocks it
    setTimeout(async () => {
      const exportBtn = document.querySelector('[title="导出作品"]');
      if (exportBtn) {
        exportBtn.classList.add('animate-pulse', 'text-amber-500');
      }

      const targetIds = selectedIds.length > 0 ? selectedIds : elements.map(e => e.id);
      const targetElements = elements.filter(el => targetIds.includes(el.id));

      try {
        // Calculate precision bounding box
        // 当只选中单个或部分元素时，计算它们的边界包围盒进行裁剪
        let rawMinX = Infinity, rawMinY = Infinity, maxX = -Infinity, maxY = -Infinity;
        targetElements.forEach(el => {
          const h = el.height || (el.type === 'image' ? 300 : 180);
          rawMinX = Math.min(rawMinX, el.x);
          rawMinY = Math.min(rawMinY, el.y);
          maxX = Math.max(maxX, el.x + el.width);
          maxY = Math.max(maxY, el.y + h);
        });

        const padding = 50;
        const cropX = rawMinX - padding;
        const cropY = rawMinY - padding;
        const cropW = (maxX - rawMinX) + padding * 2;
        const cropH = (maxY - rawMinY) + padding * 2;
        const exportScale = 2; // High DPI

        // Bug #12 Ultimate Native Canvas Fix: 完全抛弃 html2canvas
        // 直接使用原生 Canvas 2D API 遍历元素进行绘制 (所见即所得)
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = cropW * exportScale;
        exportCanvas.height = cropH * exportScale;
        const ctx = exportCanvas.getContext('2d')!;
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        
        ctx.scale(exportScale, exportScale);
        ctx.translate(-cropX, -cropY);

        for (const el of elements) {
          if (!targetIds.includes(el.id)) continue;

          if (el.type === 'image') {
             try {
               const img = new Image();
               await new Promise((resolve, reject) => {
                 img.onload = resolve;
                 img.onerror = reject;
                 img.src = el.content;
               });
               const imgRatio = img.width / img.height;
               const boxRatio = el.width / (el.height || 180);
               let drawW = el.width;
               let drawH = el.height || 180;
               let drawX = el.x;
               let drawY = el.y;
               
               if (imgRatio > boxRatio) {
                 drawH = el.width / imgRatio;
                 drawY = el.y + ((el.height || 180) - drawH) / 2;
               } else {
                 drawW = (el.height || 180) * imgRatio;
                 drawX = el.x + (el.width - drawW) / 2;
               }
               ctx.drawImage(img, drawX, drawY, drawW, drawH);
             } catch(e) { console.error('Failed to draw image', e); }
          } else if (el.type === 'text') {
             ctx.fillStyle = el.color || '#333333';
             const fs = el.fontSize ?? 14;
             ctx.font = `${fs}px "Inter", "Microsoft YaHei", sans-serif`;
             ctx.textBaseline = 'top';
             const lines = el.content.split('\n');
             const lineHeight = fs * (el.lineHeight || 1.5);
             lines.forEach((line, i) => {
                ctx.fillText(line, el.x + 16, el.y + 16 + (i * lineHeight));
             });
          } else if (el.type === 'path' && el.points && el.points.length > 0) {
             const hasPressure = el.points.some(p => p.pressure !== undefined && p.pressure !== 0.5);
             ctx.strokeStyle = el.strokeColor || 'black';
             ctx.lineCap = 'round';
             ctx.lineJoin = 'round';
             if (hasPressure && el.points.length > 1) {
               // 压力感应：逐段绘制
               for (let i = 1; i < el.points.length; i++) {
                 const prev = el.points[i - 1];
                 const pt = el.points[i];
                 const avgP = ((prev.pressure || 0.5) + (pt.pressure || 0.5)) / 2;
                 ctx.lineWidth = Math.max(0.5, (el.strokeWidth || 3) * avgP);
                 ctx.beginPath();
                 ctx.moveTo(prev.x + el.x, prev.y + el.y);
                 ctx.lineTo(pt.x + el.x, pt.y + el.y);
                 ctx.stroke();
               }
             } else {
               ctx.beginPath();
               el.points.forEach((pt, i) => {
                 if (i === 0) ctx.moveTo(pt.x + el.x, pt.y + el.y);
                 else ctx.lineTo(pt.x + el.x, pt.y + el.y);
               });
               ctx.lineWidth = el.strokeWidth || 3;
               ctx.stroke();
             }
          }
        }

        const cropCanvas = exportCanvas;

        const dataUrl = cropCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `lumina-${selectedIds.length > 0 ? 'selection' : 'design'}-${Date.now()}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log("Export Success");
        setToastMsg("图片已成功导出至本地");
      } catch (err) {
        console.error("Export Error:", err);
        setToastMsg("导出失败，请重试");
        setTimeout(() => setToastMsg(null), 3000);
      } finally {
        setIsExporting(false);
        const btn = document.querySelector('[title="导出作品"]');
        if (btn) {
          btn.classList.remove('animate-pulse', 'text-amber-500');
        }
        setTimeout(() => setToastMsg(null), 3000);
      }
    }, 100);
  };

  const handleClearCanvas = () => {
    if (confirm("确定清空画布吗？")) {
      saveHistory(elementsRef.current);
      setElements([]);
      localStorage.removeItem(STORAGE_KEY);
      setSelectedIds([]);
    }
  };

  const toggleDrawer = (drawer: 'layers' | 'typography') => {
    setActiveDrawer(prev => prev === drawer ? null : drawer);
  };

  const handleShowToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }, []);

  const handleSendMessage = async (textOverride?: string) => {
    let textToSend = textOverride || inputText;
    if (!textToSend.trim()) return;

    // #9: "功能简介"直接返回预设的工作站介绍文本，不发 AI 请求
    if (textToSend === '功能简介') {
      setMessages(prev => [...prev, { role: 'user', text: '功能简介', timestamp: new Date() }]);
      setInputText('');
      setMessages(prev => [...prev, { role: 'assistant', text: `## Lumina AI 设计工作台\n\n**Lumina** 是一款专为电商设计师打造的智能设计工作台，核心功能包括：\n\n### 🖼️ 画布操作\n- **导入图片**：拖拽、粘贴或点击工具栏导入按钮添加图片素材\n- **文字卡片**：添加可编辑的文字元素，支持调节颜色、行高、字间距\n- **自由画笔**：按 **B 键** 切换画笔模式，支持调节粗细和颜色\n- **多选与对齐**：框选多个元素后自动出现对齐工具栏\n- **缩放与平移**：滚轮缩放、按住空格拖拽平移画布\n\n### 🤖 AI 助手\n- 选中画布元素后，AI 可进行**视觉分析、设计建议、提示词生成**\n- 支持 Stable Diffusion 和即梦等平台的提示词输出\n\n### 📦 图层管理\n- 右侧 Dock 栏可展开**图层面板**和**文字工具面板**\n- 支持图层上下排序、重命名、删除\n\n### 📤 导出\n- 支持导出全图或仅导出选中元素为高清 PNG\n\n### ⌨️ 快捷键\n| 快捷键 | 功能 |\n|--------|------|\n| V | 选择工具 |\n| B | 画笔工具 |\n| Ctrl+Z | 撤销 |\n| Ctrl+Y | 重做 |\n| Delete | 删除选中 |\n| [ / ] | 调整画笔粗细 |`, timestamp: new Date() }]);
      return;
    }

    // Bug #6: 空画布时为通用快捷 Prompt 添加上下文说明
    const genericPrompts = ['配色优化方案', '导出设计技巧'];
    if (genericPrompts.includes(textToSend) && elements.length === 0) {
      textToSend = `[当前画布为空，无任何设计元素] 请回答关于 Lumina 设计工作台的问题：${textToSend}`;
    }

    // Bug #6: 消息气泡显示用户原始输入，AI 使用加工后的 textToSend
    setMessages(prev => [...prev, { role: 'user', text: textOverride || inputText, timestamp: new Date() }]);
    setInputText('');
    setIsTyping(true);

    try {
      const elementsToSend = selectedIds.length > 0
        ? elements.filter(el => selectedIds.includes(el.id))
        : [];

      let globalScreenshotBase64: string | undefined = undefined;
      // Bug 6 Fix: always generate global screenshot for AI context even if there are selected elements.
      if (elements.length > 0 && canvasContentRef.current) {
        try {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          elements.forEach(el => {
            const h = el.height || (el.type === 'image' ? 300 : 180);
            minX = Math.min(minX, el.x); minY = Math.min(minY, el.y);
            maxX = Math.max(maxX, el.x + el.width); maxY = Math.max(maxY, el.y + h);
          });
          const pd = 50;
          const cropX = minX - pd;
          const cropY = minY - pd;
          const cropW = (maxX - minX) + pd * 2;
          const cropH = (maxY - minY) + pd * 2;

          // AI Screenshot Fix: 改用与导出功能相同的 原生 Canvas 绘制，避免复杂 DOM 截图失败
          const aiCanvas = document.createElement('canvas');
          aiCanvas.width = cropW;
          aiCanvas.height = cropH;
          const ctx = aiCanvas.getContext('2d')!;
          
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, aiCanvas.width, aiCanvas.height);
          ctx.translate(-cropX, -cropY);
          
          for (const el of elements) {
            if (el.type === 'image') {
               try {
                 const img = new Image();
                 await new Promise((resolve, reject) => {
                   img.onload = resolve;
                   img.onerror = reject;
                   img.src = el.content;
                 });
                 const imgRatio = img.width / img.height;
                 const boxRatio = el.width / (el.height || 180);
                 let drawW = el.width; let drawH = el.height || 180;
                 let drawX = el.x; let drawY = el.y;
                 if (imgRatio > boxRatio) {
                   drawH = el.width / imgRatio;
                   drawY = el.y + ((el.height || 180) - drawH) / 2;
                 } else {
                   drawW = (el.height || 180) * imgRatio;
                   drawX = el.x + (el.width - drawW) / 2;
                 }
                 ctx.drawImage(img, drawX, drawY, drawW, drawH);
               } catch(e) { }
            } else if (el.type === 'text') {
               ctx.fillStyle = el.color || '#333333';
               const fs = el.fontSize ?? 14;
               ctx.font = `${fs}px "Inter", "Microsoft YaHei", sans-serif`;
               ctx.textBaseline = 'top';
               const lines = el.content.split('\n');
               const lineHeight = fs * (el.lineHeight || 1.5);
               lines.forEach((line, i) => { ctx.fillText(line, el.x + 16, el.y + 16 + (i * lineHeight)); });
            } else if (el.type === 'path' && el.points && el.points.length > 0) {
               const hasPressure = el.points.some(p => p.pressure !== undefined && p.pressure !== 0.5);
               ctx.strokeStyle = el.strokeColor || 'black';
               ctx.lineCap = 'round'; ctx.lineJoin = 'round';
               if (hasPressure && el.points.length > 1) {
                 for (let i = 1; i < el.points.length; i++) {
                   const prev = el.points[i - 1];
                   const pt = el.points[i];
                   const avgP = ((prev.pressure || 0.5) + (pt.pressure || 0.5)) / 2;
                   ctx.lineWidth = Math.max(0.5, (el.strokeWidth || 3) * avgP);
                   ctx.beginPath();
                   ctx.moveTo(prev.x + el.x, prev.y + el.y);
                   ctx.lineTo(pt.x + el.x, pt.y + el.y);
                   ctx.stroke();
                 }
               } else {
                 ctx.beginPath();
                 el.points.forEach((pt, i) => {
                   if (i === 0) ctx.moveTo(pt.x + el.x, pt.y + el.y);
                   else ctx.lineTo(pt.x + el.x, pt.y + el.y);
                 });
                 ctx.lineWidth = el.strokeWidth || 3;
                 ctx.stroke();
               }
            }
          }

          globalScreenshotBase64 = aiCanvas.toDataURL('image/png');
        } catch (e) { console.error("AI Shot Err", e); }
      }

      const aiPromise = getAIResponse(textToSend, elementsToSend, globalScreenshotBase64);
      // Vertex AI gemini-2.5-pro 是思考模型，需要更长的等待时间
      const responseText = await Promise.race([
        aiPromise,
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('AI响应超时')), 60000))
      ]);

      setMessages(prev => [...prev, { role: 'assistant', text: responseText, timestamp: new Date() }]);
    } catch (error) {
      console.error("AI Assistant Error:", error);
      setMessages(prev => [...prev, { role: 'assistant', text: "Lumina 思考时间过长或遇到网络波动，请检查网络或稍后再试。", timestamp: new Date() }]);
    } finally {
      setIsTyping(false);
    }
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isTyping]);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-gray-50 text-gray-800 font-sans selection:bg-violet-200"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsExternalDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsExternalDragging(false); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsExternalDragging(false); processFiles(Array.from(e.dataTransfer.files), e.clientX, e.clientY); }}
    >
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[15000] bg-gray-800 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-in slide-in-from-top-4 fade-in">
          <i className="fa-solid fa-circle-check text-green-400"></i>
          <span className="text-sm font-bold">{toastMsg}</span>
        </div>
      )}

      {/* Alignment Toolbar Header */}
      {selectedIds.length >= 2 && (
        <div
          className="absolute top-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-1.5 px-4 py-2 bg-white/80 backdrop-blur-xl border border-gray-200 shadow-xl rounded-2xl animate-in slide-in-from-top-4 fade-in cursor-default"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1 pr-3 border-r border-gray-200">
            <button title="左对齐" onPointerDown={(e) => { e.stopPropagation(); handleAlign('left'); }} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"><i className="fa-solid fa-align-left text-sm pointer-events-none"></i></button>
            <button title="水平居中" onPointerDown={(e) => { e.stopPropagation(); handleAlign('center-h'); }} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"><i className="fa-solid fa-align-center text-sm pointer-events-none"></i></button>
            <button title="右对齐" onPointerDown={(e) => { e.stopPropagation(); handleAlign('right'); }} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"><i className="fa-solid fa-align-right text-sm pointer-events-none"></i></button>
          </div>
          <div className="flex items-center gap-1 px-3 border-r border-gray-200">
            <button title="顶对齐" onPointerDown={(e) => { e.stopPropagation(); handleAlign('top'); }} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors -rotate-90"><i className="fa-solid fa-align-right text-sm pointer-events-none"></i></button>
            <button title="垂直居中" onPointerDown={(e) => { e.stopPropagation(); handleAlign('center-v'); }} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"><i className="fa-solid fa-align-center text-sm rotate-90 pointer-events-none"></i></button>
            <button title="底对齐" onPointerDown={(e) => { e.stopPropagation(); handleAlign('bottom'); }} className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors -rotate-90"><i className="fa-solid fa-align-left text-sm pointer-events-none"></i></button>
          </div>
          {selectedIds.length >= 3 && (
            <div className="flex items-center gap-1 px-3 border-r border-gray-200">
              {/* 水平等间距分布 - 内联 SVG（FA Pro 图标不可用，用 SVG 替代） */}
              <button
                title="水平等间距分布"
                onPointerDown={(e) => { e.stopPropagation(); handleAlign('distribute-h'); }}
                className="flex items-center gap-1 px-2 h-8 text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors text-[11px] font-bold"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" className="pointer-events-none shrink-0">
                  <rect x="0.5" y="1" width="2" height="12" rx="1"/>
                  <rect x="6" y="3" width="2" height="8" rx="1"/>
                  <rect x="11.5" y="1" width="2" height="12" rx="1"/>
                  <rect x="2.5" y="6.5" width="3.5" height="1" rx="0.5"/>
                  <rect x="8" y="6.5" width="3.5" height="1" rx="0.5"/>
                </svg>
                水平
              </button>
              {/* 垂直等间距分布 - 内联 SVG */}
              <button
                title="垂直等间距分布"
                onPointerDown={(e) => { e.stopPropagation(); handleAlign('distribute-v'); }}
                className="flex items-center gap-1 px-2 h-8 text-gray-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors text-[11px] font-bold"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" className="pointer-events-none shrink-0">
                  <rect x="1" y="0.5" width="12" height="2" rx="1"/>
                  <rect x="3" y="6" width="8" height="2" rx="1"/>
                  <rect x="1" y="11.5" width="12" height="2" rx="1"/>
                  <rect x="6.5" y="2.5" width="1" height="3.5" rx="0.5"/>
                  <rect x="6.5" y="8" width="1" height="3.5" rx="0.5"/>
                </svg>
                垂直
              </button>
            </div>
          )}
          <div className="pl-1">
            <span className="text-xs font-black text-violet-600 bg-violet-50 px-2 py-0.5 rounded-md">
              已选中 {selectedIds.length} 项
            </span>
          </div>
        </div>
      )}

      {/* Typography Panel moved to Right Sidebar */}

      <main
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onContextMenu={(e) => {
          e.preventDefault();
          if (toolMode !== 'select') return;
          const target = e.target as HTMLElement;
          const elElement = target.closest('[data-element-id]');
          const targetId = elElement ? elElement.getAttribute('data-element-id') || undefined : undefined;
          if (targetId && !selectedIds.includes(targetId)) {
            setSelectedIds([targetId]);
          }
          setContextMenu({ x: e.clientX, y: e.clientY, targetId });
        }}
        className={`flex-1 relative overflow-hidden touch-none select-none z-0 min-w-0`}
        style={{
          cursor: cursorStyle,
          backgroundImage: 'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)',
          backgroundSize: `${20 * scale}px ${20 * scale}px`,
          backgroundPosition: `${offset.x}px ${offset.y}px`
        }}
        tabIndex={0}
      >
        <div
          ref={canvasContentRef}
          className="layer-sys origin-top-left absolute top-0 left-0 pointer-events-none"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, width: '10000px', height: '10000px' }}
        >
          {elements.map(el => (
            <CanvasElementComp key={el.id} element={el} isSelected={selectedIds.includes(el.id)} isEditing={editingId === el.id} isDrawingMode={toolMode !== 'select'}
              onSelect={handleElementSelect} onDragStart={handleElementDragStart} onResizeStart={handleElementResizeStart} onDoubleClick={handleElementDoubleClick}
              onUpdateContent={handleElementUpdateContent} onFinishEdit={handleElementFinishEdit} />
          ))}

          {toolMode === 'draw' && currentPoints.length > 0 && (
            <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-[9999]" style={{ overflow: 'visible' }}>
              {currentPoints.length === 1 ? (
                <circle cx={currentPoints[0].x} cy={currentPoints[0].y}
                  r={brushSize * (currentPoints[0].pressure || 0.5) / 2}
                  fill={activeColor} />
              ) : (
                currentPoints.slice(1).map((pt, i) => {
                  const prev = currentPoints[i];
                  const avgPressure = ((prev.pressure || 0.5) + (pt.pressure || 0.5)) / 2;
                  const w = brushSize * avgPressure;
                  return (
                    <line key={i} x1={prev.x} y1={prev.y} x2={pt.x} y2={pt.y}
                      stroke={activeColor} strokeWidth={Math.max(0.5, w)}
                      strokeLinecap="round" />
                  );
                })
              )}
            </svg>
          )}

          {/* Normal Multiple Selection Box Visual */}
          {selectionBox && (
            <div
              className="absolute border border-violet-500 bg-violet-100 bg-opacity-30 pointer-events-none z-[10000]"
              style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }}
            />
          )}

          {guides.map((guide, i) => <div key={i} className="absolute border-red-500 border-dashed pointer-events-none z-[10001] alignment-guide" style={{ top: guide.type === 'horizontal' ? guide.pos : 0, left: guide.type === 'vertical' ? guide.pos : 0, width: guide.type === 'horizontal' ? '10000px' : '1px', height: guide.type === 'vertical' ? '10000px' : '1px', borderWidth: guide.type === 'horizontal' ? '1px 0 0 0' : '0 0 0 1px' }} />)}
        </div>

        {/* Floating Toolbar Glassmorphism */}
        {/* Bug #11: flex-nowrap 防止画笔模式展开时工具栏按钮重叠 */}
        {/* Bug #1: file input 放在工具栏外部，完全独立于按钮层级 */}
        <input type="file" multiple ref={fileInputRef} className="hidden" accept="image/*" onChange={handleUpload} />
        <div className="floating-toolbar absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center flex-nowrap bg-white/70 backdrop-blur-xl border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.08)] rounded-full px-4 py-3 gap-3 z-30 pointer-events-auto transition-transform hover:scale-[1.02]" onPointerDown={(e) => e.stopPropagation()}>
          <button title="导入图片" onPointerDown={(e) => { e.stopPropagation(); setTimeout(() => fileInputRef.current?.click(), 0); }} className="w-10 h-10 flex items-center justify-center bg-violet-600 hover:bg-violet-700 text-white rounded-full cursor-pointer transition-all shadow-md active:scale-95 shrink-0">
            <i className="fa-solid fa-image text-sm"></i>
          </button>
          <button title="输入文本" onPointerDown={(e) => { e.stopPropagation(); addTextCard(); }} className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 hover:border-violet-300 hover:text-violet-600 text-gray-700 rounded-full cursor-pointer transition-all shadow-sm active:scale-95 shrink-0">
            <i className="fa-solid fa-t text-sm"></i>
          </button>

          {/* AI 生图按钮 */}
          <button
            title="AI 生图（Imagen 3）"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (!showAIImagePanel) {
                const selectedImages = elementsRef.current
                  .filter(el => selectedIdsRef.current.includes(el.id) && el.type === 'image')
                  .slice(0, 2)
                  .map(el => el.content);
                setAiEditImageDataUrls(selectedImages);
              }
              setShowAIImagePanel(prev => !prev);
            }}
            className={`w-10 h-10 flex items-center justify-center rounded-full cursor-pointer transition-all shadow-sm active:scale-95 shrink-0 border ${
              showAIImagePanel
                ? 'bg-gradient-to-br from-violet-600 to-fuchsia-500 border-transparent text-white shadow-md shadow-violet-300'
                : 'bg-white border-gray-200 hover:border-violet-300 hover:text-violet-600 text-gray-700'
            }`}
          >
            <i className="fa-solid fa-wand-magic-sparkles text-sm" />
          </button>

          <button
            type="button"
            className="relative w-10 h-10 shrink-0 flex items-center justify-center bg-white border border-gray-200 rounded-full shadow-sm hover:border-violet-300 cursor-pointer"
            title="全局颜色拾取器"
            onClick={(e) => {
              e.stopPropagation();
              document.getElementById('hidden-color-picker')?.click();
            }}
          >
            <div className="w-5 h-5 rounded-full shadow-inner border border-black/10 pointer-events-none" style={{ backgroundColor: activeColor }}></div>
          </button>

          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/50 rounded-full border border-white/40 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)] shrink-0">
            <button
              onClick={() => {
                const next = toolMode === 'draw' ? 'select' : 'draw';
                setToolMode(next);
                setCurrentPoints([]);
                dragRef.current = null;
                setSelectionBox(null);
                setGuides([]);
              }}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${toolMode === 'draw' ? 'bg-violet-600 text-white shadow-md shadow-violet-500/30' : 'text-gray-600 hover:bg-white hover:shadow-sm'}`}
              title="自由画笔 / 选择工具"
            >
              <i className="fa-solid fa-paintbrush"></i>
            </button>
            {toolMode === 'draw' && (
              <div className="flex items-center gap-2 px-2 animate-in fade-in slide-in-from-left-2 origin-left border-l border-gray-200/50 pl-3 shrink-0">
                <i className="fa-solid fa-circle text-gray-400 text-[8px]" style={{ transform: `scale(${brushSize / 50 + 0.5})` }}></i>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-24 h-1.5 bg-violet-100 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-violet-600 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md hover:[&::-webkit-slider-thumb]:scale-110 active:[&::-webkit-slider-thumb]:scale-95 transition-all"
                  title={`画笔粗细: ${brushSize}px`}
                />
                {/* Bug #10: Hex 颜色输入框 */}
                <input
                  type="text"
                  value={activeColor}
                  onChange={(e) => setActiveColor(e.target.value)}
                  onBlur={(e) => {
                    let v = e.target.value.trim();
                    if (v && !v.startsWith('#')) v = '#' + v;
                    if (/^#[0-9a-fA-F]{3,6}$/.test(v)) {
                      setActiveColor(v);
                    }
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-[72px] text-xs font-mono text-center border border-gray-200 rounded-full py-1 bg-white/80 focus:outline-none focus:border-violet-400 uppercase transition-colors shrink-0"
                  placeholder="#000000"
                />
              </div>
            )}
          </div>
          <div className="w-[1px] h-6 bg-gray-200 mx-1 shrink-0"></div>

          <button title={past.length === 0 ? '无可撤销的操作' : '撤销 (Ctrl+Z)'} onClick={undo} disabled={past.length === 0} className={`w-9 h-9 flex items-center justify-center rounded-full transition-all shrink-0 ${past.length === 0 ? 'opacity-30 cursor-not-allowed text-gray-400' : 'hover:bg-gray-100 text-gray-700 active:scale-90'}`}>
            <i className="fa-solid fa-rotate-left text-sm"></i>
          </button>
          <button title={future.length === 0 ? '无可重做的操作' : '重做 (Ctrl+Y)'} onClick={redo} disabled={future.length === 0} className={`w-9 h-9 flex items-center justify-center rounded-full transition-all shrink-0 ${future.length === 0 ? 'opacity-30 cursor-not-allowed text-gray-400' : 'hover:bg-gray-100 text-gray-700 active:scale-90'}`}>
            <i className="fa-solid fa-rotate-right text-sm"></i>
          </button>

          <div className="w-[1px] h-6 bg-gray-200 mx-1 shrink-0"></div>

          <button
            title={selectedIds.length === 0 ? '请先选中元素' : '删除选中图元 (Delete)'}
            onClick={handleDeleteSelected}
            disabled={selectedIds.length === 0}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-all shadow-sm shrink-0 ${selectedIds.length === 0 ? 'opacity-30 cursor-not-allowed text-gray-400' : 'hover:bg-red-50 hover:text-red-500 text-gray-500 active:scale-95'}`}
          >
            <i className="fa-solid fa-trash text-sm"></i>
          </button>

          <button type="button" title="导出作品" onClick={(e) => { e.stopPropagation(); setExportModalOpen(true); }} disabled={isExporting || elements.length === 0} className={`w-9 h-9 flex items-center justify-center rounded-full transition-all shadow-sm shrink-0 ${isExporting ? 'text-gray-400' : 'hover:bg-green-50 hover:text-green-600 text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed'}`}>
            <i className={`fa-solid ${isExporting ? 'fa-spinner fa-spin' : 'fa-download'} text-sm`}></i>
          </button>

          <div className="w-[1px] h-6 bg-gray-200 mx-1 shrink-0"></div>

          <div className="flex items-center bg-gray-50/50 rounded-full border border-gray-100 p-1 shrink-0">
            <button title="缩小视图" onClick={() => setScale(s => Math.max(0.1, s - 0.2))} className="w-7 h-7 flex items-center justify-center hover:bg-white rounded-full bg-white shadow-sm text-gray-600"><i className="fa-solid fa-minus text-[10px]"></i></button>
            {/* Bug #5: 引入本地状态 zoomInputValue 使输入框可编辑 */}
            <input
              title="双击或点击后输入缩放百分比"
              className="w-14 text-center font-mono text-xs font-bold text-gray-600 bg-transparent outline-none focus:bg-white focus:rounded focus:shadow-inner"
              style={{ padding: '0 2px' }}
              value={isZoomFocused ? zoomInputValue : Math.round(scale * 100) + '%'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => {
                setIsZoomFocused(true);
                setZoomInputValue(Math.round(scale * 100).toString());
                setTimeout(() => e.target.select(), 0);
              }}
              onBlur={() => {
                setIsZoomFocused(false);
                const val = parseInt(zoomInputValue.replace(/%/g, ''));
                if (!isNaN(val) && val > 0) setScale(Math.min(Math.max(val / 100, 0.1), 5));
              }}
              onChange={(e) => setZoomInputValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            <button title="放大视图" onClick={() => setScale(s => Math.min(5, s + 0.2))} className="w-7 h-7 flex items-center justify-center hover:bg-white rounded-full bg-white shadow-sm text-gray-600"><i className="fa-solid fa-plus text-[10px]"></i></button>
          </div>
          <button title="自适应/还原视图" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }} className="w-9 h-9 flex items-center justify-center bg-violet-50 text-violet-600 hover:bg-violet-100 rounded-full shadow-sm ml-1 shrink-0"><i className="fa-solid fa-compress text-sm"></i></button>
        </div>

        {/* AI 生图面板 */}
        <AIImagePanel
          isOpen={showAIImagePanel}
          onClose={() => setShowAIImagePanel(false)}
          onInsertImage={handleInsertAIImage}
          onShowToast={handleShowToast}
          selectedImageDataUrls={aiEditImageDataUrls}
        />

        {isResizingRight && <div className="fixed inset-0 z-50 cursor-col-resize pointer-events-auto bg-black/5" />}

        {/* Hidden Global Color Picker to solve Bug #1 transform offset bug */}
        <input
          id="hidden-color-picker"
          type="color"
          value={activeColor}
          onChange={handleColorChange}
          className="fixed left-1/2 bottom-20 opacity-0 pointer-events-none z-[-1]"
          style={{ transform: 'translate(-50%, 0)' }}
        />

        {/* Context Menu */}
        {
          contextMenu && (
            <div
              className="fixed z-[10002] bg-white/90 backdrop-blur-md rounded-xl shadow-2xl py-2 min-w-[160px] text-sm text-gray-700 border border-gray-100"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onPointerDown={e => e.stopPropagation()}
              onContextMenu={e => e.preventDefault()}
            >
              {contextMenu.targetId ? (
                <>
                  <button className="w-full text-left px-5 py-2 hover:bg-violet-50 hover:text-violet-600 transition-colors" onPointerDown={() => { handleLayerMove(contextMenu.targetId!, 'up'); setContextMenu(null); }}>
                    <i className="fa-solid fa-arrow-up w-5 text-center text-xs mr-2 opacity-60"></i>移至上方
                  </button>
                  <button className="w-full text-left px-5 py-2 hover:bg-violet-50 hover:text-violet-600 transition-colors border-b border-gray-100/50" onPointerDown={() => { handleLayerMove(contextMenu.targetId!, 'down'); setContextMenu(null); }}>
                    <i className="fa-solid fa-arrow-down w-5 text-center text-xs mr-2 opacity-60"></i>移至下方
                  </button>
                  <button className="w-full text-left px-5 py-2 hover:bg-red-50 hover:text-red-500 transition-colors text-red-600 mt-1" onPointerDown={() => { handleDeleteSelected(); setContextMenu(null); }}>
                    <i className="fa-solid fa-trash w-5 text-center text-xs mr-2 opacity-60"></i>删除选中项
                  </button>
                </>
              ) : (
                <>
                  <button className="w-full text-left px-5 py-2 hover:bg-violet-50 hover:text-violet-600 transition-colors" onPointerDown={() => { setContextMenu(null); setTimeout(() => fileInputRef.current?.click(), 0); }}>
                    <i className="fa-solid fa-image w-5 text-center text-xs mr-2 opacity-60"></i>上传图片
                  </button>
                  <button className="w-full text-left px-5 py-2 hover:bg-violet-50 hover:text-violet-600 transition-colors border-b border-gray-100/50" onPointerDown={() => { addTextCard(); setContextMenu(null); }}>
                    <i className="fa-solid fa-t w-5 text-center text-xs mr-2 opacity-60"></i>添加文字
                  </button>
                  <button className="w-full text-left px-5 py-2 hover:bg-violet-50 transition-colors text-gray-500 mt-1" onPointerDown={() => { setScale(1); setOffset({ x: 0, y: 0 }); setContextMenu(null); }}>
                    <i className="fa-solid fa-compress w-5 text-center text-xs mr-2 opacity-60"></i>重置视图
                  </button>
                </>
              )}
            </div>
          )
        }

        {/* Export Modal */}
        {
          exportModalOpen && (
            <div className="fixed inset-0 z-[11000] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onPointerDown={() => setExportModalOpen(false)}>
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-[420px] shrink-0" onPointerDown={e => e.stopPropagation()}>
                <h3 className="text-base font-black text-gray-800 mb-4 flex items-center gap-2"><i className="fa-solid fa-download text-violet-500"></i>导出设计</h3>
                <p className="text-sm text-gray-500 mb-6 font-medium leading-relaxed whitespace-normal break-words">目前仅支持导出为包含所有可见元素的 PNG 高清图片。未来将增加 PDF 与 JPG 等更多格式配置选项。</p>
                <div className="flex gap-3 flex-wrap">
                  <button type="button" onClick={() => setExportModalOpen(false)} className="flex-1 min-w-[120px] py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold transition-colors">取消</button>
                  <button type="button" onClick={() => { setExportModalOpen(false); handleExport(); }} className="flex-1 min-w-[120px] py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold shadow-md shadow-violet-200 transition-colors">确认导出</button>
                </div>
              </div>
            </div>
          )
        }

        {/* Global Toast Notification - Bug #8 Fixed */}
        <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[12000] transition-all duration-300 pointer-events-none flex items-center gap-2 px-5 py-3 rounded-2xl shadow-xl border ${toastMsg ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-95'} ${toastMsg?.includes('失败') || toastMsg?.includes('空') ? 'bg-red-50 border-red-100 text-red-600' : toastMsg?.includes('成功') ? 'bg-green-50 border-green-100 text-green-600' : 'bg-white/90 backdrop-blur border-gray-100 text-gray-800'}`}>
          <i className={`fa-solid ${toastMsg?.includes('失败') || toastMsg?.includes('空') ? 'fa-circle-exclamation' : toastMsg?.includes('成功') ? 'fa-circle-check' : 'fa-info-circle'} ${toastMsg?.includes('成功') ? 'text-green-500' : toastMsg?.includes('失败') ? 'text-red-500' : 'text-violet-500'}`}></i>
          <span className="text-sm font-bold tracking-tight">{toastMsg}</span>
        </div>

      </main >

      {/* Drawer Wrapper for Layer / Typography Panels - Moved outside <main> to avoid overflow: hidden clipping */}
      <div
        className={`fixed z-[45] transition-all duration-300 ${activeDrawer ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        style={{
          right: `${64 + rightPanelWidth + 16}px`, // RightDock(64px) + AI Panel + gap(16px) — sits LEFT of the AI panel
          top: '50%',
          transform: `translateY(-50%) ${activeDrawer ? 'translateX(0)' : 'translateX(30px)'}`,
          transition: 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.2s'
        }}
      >
        {activeDrawer === 'layers' && (
          <div className="pointer-events-auto">
            <LayerPanel
              elements={elements}
              selectedIds={selectedIds}
              onSelectElement={handleElementSelect}
              onMoveElement={handleLayerMove}
              onRenameElement={handleElementRename}
              onDeleteElement={handleDeleteElement}
              isDrawer={true}
              onClose={() => setActiveDrawer(null)}
              onDetach={(startX, startY, pointerId) => handleDetach('layers', startX, startY, pointerId)}
            />
          </div>
        )}
        {activeDrawer === 'typography' && (
          <div className="pointer-events-auto">
            <TypographyPanel
              elements={elements}
              selectedIds={selectedIds}
              onChange={handleTextPropertyChange}
              isDrawer={true}
              onClose={() => setActiveDrawer(null)}
              onDetach={(startX, startY, pointerId) => handleDetach('typography', startX, startY, pointerId)}
            />
          </div>
        )}
      </div>

      {/* Global Click Scrim for Drawer (Closes drawer when clicking canvas) */}
      {/* Bug #2: z-[34] 确保低于 RightDock 的 z-[45]，遮罩不覆盖侧边栏 */}
      {activeDrawer && (
        <div
          className="fixed inset-0 z-[34] bg-transparent pointer-events-auto"
          onPointerDown={(e) => { e.stopPropagation(); setActiveDrawer(null); }}
        />
      )}

      <div onPointerDown={startResizing} className={`w-1.5 h-full cursor-col-resize z-30 transition-colors duration-200 shrink-0 ${isResizingRight ? 'bg-violet-500' : 'bg-transparent hover:bg-violet-300'}`} />

      {/* Floating Undocked Panels */}
      {!dockedPanels.includes('layers') && (
        <LayerPanel
          elements={elements}
          selectedIds={selectedIds}
          onSelectElement={handleElementSelect}
          onMoveElement={handleLayerMove}
          onRenameElement={handleElementRename}
          onDeleteElement={handleDeleteElement}
          isDrawer={false}
          onDock={() => handleDock('layers')}
          onDetach={(sx, sy, pid) => handleDetach('layers', sx, sy, pid)}
          initialDrag={dragHandOff?.id === 'layers' ? dragHandOff : null}
        />
      )}
      {!dockedPanels.includes('typography') && (
        <TypographyPanel
          elements={elements}
          selectedIds={selectedIds}
          onChange={handleTextPropertyChange}
          isDrawer={false}
          onDock={() => handleDock('typography')}
          onDetach={(sx, sy, pid) => handleDetach('typography', sx, sy, pid)}
          initialDrag={dragHandOff?.id === 'typography' ? dragHandOff : null}
        />
      )}

      {/* New Right Dock Bar - Static Full-Height Sidebar */}
      <RightDock
        activeDrawer={activeDrawer}
        dockedPanels={dockedPanels}
        onToggle={toggleDrawer}
        hasSelection={selectedIds.length > 0}
        onShowToast={handleShowToast}
      />

      <aside style={{ width: `${rightPanelWidth}px`, maxWidth: '400px' }} className="bg-white border-l border-black/5 flex flex-col z-20 shadow-[-10px_0_30px_rgba(0,0,0,0.03)] shrink-0 relative overflow-hidden">
        <div className="flex flex-col h-full border-b border-gray-100">
          <div className="p-8 border-b border-gray-50 shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-black flex items-center gap-2 tracking-tight text-gray-800">
                <i className="fa-solid fa-wand-magic-sparkles text-violet-500"></i>
                Lumina AI 助手
              </h2>
            </div>
            {(() => {
              const safeSelectedElements = elements.filter(el => selectedIds.includes(el.id));
              const hasSelection = safeSelectedElements.length > 0;
              return (
                <div
                  className={`p-4 rounded-2xl border transition-all ${hasSelection ? 'bg-violet-50/50 border-violet-100 shadow-sm cursor-pointer hover:shadow-md hover:border-violet-200 active:scale-[0.99]' : 'bg-gray-50 border-gray-100 opacity-60'}`}
                  onClick={() => {
                    if (!hasSelection) return;
                    // Bug #1 Fix: 点击选中素材卡片触发 AI 分析
                    if (safeSelectedElements.length === 1) {
                      const el = safeSelectedElements[0];
                      const prompt = el.type === 'image' ? '分析选中素材的视觉设计' : el.type === 'text' ? '分析选中的文字内容' : '分析选中的绘画路径';
                      handleSendMessage(prompt);
                    } else {
                      handleSendMessage(`批量分析选中的 ${safeSelectedElements.length} 个素材`);
                    }
                  }}
                >
                  {hasSelection ? (
                    safeSelectedElements.length === 1 ? (
                      // Single Item View (Existing)
                      (() => {
                        const el = safeSelectedElements[0];
                        return (
                          <div className="flex items-center gap-4">
                            <div className="w-14 h-14 bg-white rounded-xl flex items-center justify-center border border-violet-100 overflow-hidden shrink-0 shadow-sm">
                              {el.type === 'image' && el.content ? <img src={el.content} className="w-full h-full object-cover" alt="sel" /> : <i className={`fa-solid ${el.type === 'path' ? 'fa-pen-nib' : el.type === 'image' ? 'fa-image' : 'fa-font'} text-violet-400 text-xl`}></i>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-black text-violet-900 truncate uppercase tracking-widest">{el.name || '智能对象'}</p>
                              {el.sourceResolution && (
                                <p className="text-[11px] text-violet-400 font-bold opacity-80 mt-0.5">
                                  {el.sourceResolution.width}×{el.sourceResolution.height}（{formatResolutionTier(el.sourceResolution.width, el.sourceResolution.height)}）
                                </p>
                              )}
                              <p className="text-[11px] text-violet-500 font-bold opacity-80 mt-1">点击分析选中素材 →</p>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      // Multi Item View (New)
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-black text-violet-900 uppercase tracking-widest flex items-center gap-2">
                            <i className="fa-solid fa-layer-group text-violet-400"></i>
                            已选 {safeSelectedElements.length} 个素材
                          </p>
                          <p className="text-[10px] text-violet-400 font-bold opacity-80">点击批量分析 →</p>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {(() => {
                            // Dynamic calculation: (PanelWidth - 48px padding - 32px card padding) / (40px item + 8px gap)
                            const maxItemsFull = Math.floor((rightPanelWidth - 90) / 48);
                            const showMore = safeSelectedElements.length > maxItemsFull;
                            const maxItems = showMore ? maxItemsFull - 1 : maxItemsFull;

                            return (
                              <>
                                {safeSelectedElements.slice(0, Math.max(1, maxItems)).map(el => (
                                  <div key={el.id} className="w-10 h-10 bg-white rounded-lg flex items-center justify-center border border-violet-100 overflow-hidden shrink-0 shadow-sm relative group cursor-pointer hover:border-violet-300 transition-colors" title={el.name}>
                                    {el.type === 'image' ? <img src={el.content} className="w-full h-full object-cover" alt={el.name} /> : <i className={`fa-solid ${el.type === 'path' ? 'fa-pen-nib' : 'fa-font'} text-violet-300 text-xs`}></i>}
                                  </div>
                                ))}
                                {showMore && (
                                  <div className="w-10 h-10 bg-violet-50 rounded-lg flex items-center justify-center border border-violet-200 shrink-0 text-violet-600 font-black text-xs shadow-sm" title={`还有 ${safeSelectedElements.length - maxItems} 个`}>
                                    +{safeSelectedElements.length - maxItems}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )
                  ) : messages.length <= 1 ? <p className="text-sm text-gray-500 text-center py-3 font-medium">选择画布元素开启智能对话</p> : null}
                </div>
              );
            })()}
            {/* Typography Panel removed from here, now in Drawer */}
          </div>


          <div className="flex-1 overflow-y-auto px-6 py-6 pr-[70px] scrollbar-hide space-y-6 bg-white relative min-h-0 min-w-0 w-full">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex items-start gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0 shadow-sm relative ${msg.role === 'user' ? 'bg-violet-600' : 'bg-gradient-to-br from-violet-600 to-fuchsia-500'}`}>
                  <i className={`fa-solid ${msg.role === 'user' ? 'fa-user text-[10px]' : 'fa-bolt text-[10px]'}`}></i>
                  {msg.role === 'assistant' && (
                    <div className="absolute -bottom-0.5 -right-0.5 bg-white rounded-full p-0.4 border border-violet-100">
                      <div className="bg-violet-600 w-1.5 h-1.5 rounded-full"></div>
                    </div>
                  )}
                </div>
                <div className={`relative rounded-[16px] px-3.5 py-2.5 text-xs leading-[1.8] shadow-sm ${msg.role === 'user' ? 'bg-violet-600 text-white rounded-tr-none' : 'bg-gray-50 border border-gray-100 text-gray-800 rounded-tl-none'} max-w-[90%]`}>
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap font-medium">{msg.text}</p>
                  ) : (
                    <div className="font-medium leading-relaxed prose prose-sm prose-violet max-w-none prose-p:my-1 prose-headings:my-1 prose-ul:my-1 prose-ol:my-1">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  )}
                  <div className={`text-[9px] mt-1 font-bold tracking-tight opacity-50 ${msg.role === 'user' ? 'text-violet-100 text-right' : 'text-gray-400'}`}>
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 flex items-center justify-center text-white shrink-0 shadow-sm">
                  <i className="fa-solid fa-bolt text-[10px]"></i>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-[16px] rounded-tl-none px-3.5 py-2.5 flex gap-1 items-center">
                  <div className="w-1 h-1 bg-violet-400 rounded-full animate-bounce"></div>
                  <div className="w-1 h-1 bg-violet-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                  <div className="w-1 h-1 bg-violet-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                <span className="text-[10px] text-violet-500 font-bold ml-1.5 whitespace-nowrap">
                  {typingSeconds < 10 ? 'Lumina 正在思考...' : `Lumina 正在深度思考… 已等待 ${typingSeconds} 秒`}
                </span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="p-8 bg-white border-t border-gray-50">
            <div className="flex flex-wrap gap-2 mb-5">
              {(() => {
                const firstEl = elements.find(el => selectedIds.includes(el.id));
                const prompts = firstEl?.type === 'image'
                  ? ['视觉布局分析', '寻找设计灵感', '评估构图平衡']
                  : firstEl?.type === 'text'
                    ? ['文案润色建议', '调整语气风格', '扩展写作内容']
                    : ['功能简介', '配色优化方案', '导出设计技巧'];
                return prompts.map((p, i) => (
                  <button key={i} onClick={() => handleSendMessage(p)}
                    className="text-xs bg-gray-50 hover:bg-violet-50 text-violet-600 border border-gray-200 hover:border-violet-100 px-4 py-2 rounded-full font-bold shadow-sm transition-all">
                    {p}
                  </button>
                ));
              })()}
            </div>
            <div className="relative group">
              <textarea
                value={inputText}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                onCompositionStart={() => { isComposingRef.current = true; }}
                onCompositionEnd={() => { isComposingRef.current = false; }}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (isComposingRef.current) return;
                    handleSendMessage();
                  }
                }}
                placeholder="询问 Lumina..."
                className="w-full bg-gray-50/50 border border-gray-200 rounded-3xl p-5 pr-16 text-base leading-relaxed focus:outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-500 focus:bg-white transition-all shadow-inner resize-none min-h-[120px]"
              /><button type="button" onClick={() => handleSendMessage()} disabled={isTyping || !inputText.trim()} className={`absolute bottom-5 right-5 w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${inputText.trim() ? 'bg-violet-600 text-white shadow-lg shadow-violet-200 active:scale-90' : 'bg-gray-200 text-gray-400'}`}><i className="fa-solid fa-paper-plane text-sm"></i></button>
            </div>
          </div>
        </div>
      </aside>
    </div >
  );
};

export default App;
