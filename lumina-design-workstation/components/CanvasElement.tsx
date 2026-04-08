
import React, { useEffect, useRef, useMemo } from 'react';
import { CanvasElement as ICanvasElement } from '../types';

interface Props {
  element: ICanvasElement;
  isSelected: boolean;
  isEditing: boolean;
  isDrawingMode: boolean;
  onSelect: (id: string, isMulti: boolean) => void;
  onDragStart: (e: React.PointerEvent, id: string) => void;
  onResizeStart: (e: React.PointerEvent, id: string, dir: string) => void;
  onDoubleClick: (id: string) => void;
  onUpdateContent: (id: string, content: string) => void;
  onFinishEdit: () => void;
}

const CanvasElementComp: React.FC<Props> = React.memo(({
  element,
  isSelected,
  isEditing,
  isDrawingMode,
  onSelect,
  onDragStart,
  onResizeStart,
  onDoubleClick,
  onUpdateContent,
  onFinishEdit
}) => {
  const isImage = element.type === 'image';
  const isPath = element.type === 'path';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const ta = textareaRef.current;
      // Bug #9: 延迟 2 帧确保 pointerCapture 释放后再 focus
      // 防止 setPointerCapture 干扰 textarea 焦点获取
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }, 50);
    }
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, [isEditing]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onUpdateContent(element.id, e.target.value);
    // 自动撑高：内容变化后重置高度再测量 scrollHeight
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  };

  // Bug #9: 延迟 blur 处理，防止瞬间失焦导致编辑被取消
  const handleBlur = () => {
    blurTimeoutRef.current = setTimeout(() => {
      onFinishEdit();
    }, 150);
  };

  // Bug #9: 如果 textarea 重新获得焦点，取消 blur 退出
  const handleFocus = () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // 防止快捷键干扰输入
    if (e.key === 'Escape') {
      onFinishEdit();
    }
  };

  const height = element.height || (isImage ? 'auto' : 180);

  const handleResizePointerDown = (e: React.PointerEvent, dir: string) => {
    e.stopPropagation();
    // Pointer capture is essential for stable resizing with a pen
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onResizeStart(e, element.id, dir);
  };

  const handleGeneralPointerDown = (e: React.PointerEvent) => {
    if (isEditing) return;

    // Bug #3 Fix: 在画笔模式下，文字/图片元素必须阻止事件冒泡
    // 否则事件冒泡到画布 handlePointerDown 会启动绘制，在文字上留下画笔痕迹
    if (isDrawingMode) {
      e.stopPropagation();
      return;
    }

    // Check if clicking inside textarea while editing - don't stop propagation if so
    // But here we are already checking isEditing above.

    e.stopPropagation();
    if (e.button !== 0 && e.pointerType === 'mouse') return; // Allow all pointer types but restrict mouse to left click

    // Capture the pointer to ensure dragging stays linked even if pen leaves the element bounds
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    onSelect(element.id, e.shiftKey);
    onDragStart(e, element.id);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const containerStyle: React.CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.width,
    height: isPath ? element.height : height,
    position: 'absolute',
    // 文字元素在画笔模式下保留 pointerEvents 以支持双击编辑
    pointerEvents: isDrawingMode ? 'none' : 'auto',
    zIndex: isSelected ? 9999 : 'auto',
    touchAction: 'none' // Critical for stylus
  };

  const resizeHandles = isSelected && !isEditing && (
    <div className="export-ignore">
      <div
        onPointerDown={(e) => handleResizePointerDown(e, 'nw')}
        onPointerUp={handlePointerUp}
        className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-violet-500 rounded-sm cursor-nwse-resize z-[100] hover:scale-125 transition-transform resize-handle"
      />
      <div
        onPointerDown={(e) => handleResizePointerDown(e, 'ne')}
        onPointerUp={handlePointerUp}
        className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-violet-500 rounded-sm cursor-nesw-resize z-[100] hover:scale-125 transition-transform resize-handle"
      />
      <div
        onPointerDown={(e) => handleResizePointerDown(e, 'sw')}
        onPointerUp={handlePointerUp}
        className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-violet-500 rounded-sm cursor-nesw-resize z-[100] hover:scale-125 transition-transform resize-handle"
      />
      <div
        onPointerDown={(e) => handleResizePointerDown(e, 'se')}
        onPointerUp={handlePointerUp}
        className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-violet-500 rounded-sm cursor-nwse-resize z-[100] hover:scale-125 transition-transform resize-handle"
      />
    </div>
  );

  const pathContent = useMemo(() => {
    if (!isPath || !element.points || element.points.length === 0) return null;

    const xs = element.points.map(p => p.x);
    const ys = element.points.map(p => p.y);
    const maxX = Math.max(...xs, 1);
    const maxY = Math.max(...ys, 1);

    // 判断是否有有效的压力数据
    const hasPressure = element.points.some(p => p.pressure !== undefined && p.pressure !== 0.5);

    const d = element.points.reduce((acc, pt, i) => {
      return acc + (i === 0 ? `M ${pt.x} ${pt.y}` : ` L ${pt.x} ${pt.y}`);
    }, "");

    return { d, maxX, maxY, hasPressure };
  }, [isPath, element.points]);

  if (isPath && pathContent) {
    return (
      <div
        data-element-id={element.id}
        onPointerDown={handleGeneralPointerDown}
        onPointerUp={handlePointerUp}
        style={containerStyle}
        className={`group ${isSelected ? 'selected-path' : ''} no-touch`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="100%"
          height="100%"
          viewBox={`0 0 ${pathContent.maxX} ${pathContent.maxY}`}
          preserveAspectRatio="none"
          style={{ display: 'block', overflow: 'visible', pointerEvents: isDrawingMode ? 'none' : 'all' }}
        >
          {/* Bug #3 Fix: 选择模式下保留透明 hit-target path */}
          {!isDrawingMode && (
            <path
              d={pathContent.d}
              fill="none"
              stroke="transparent"
              strokeWidth={20}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ cursor: 'move' }}
              className="export-ignore"
            />
          )}
          {/* Bug #5: 压力感应渲染 — 逐段变宽 line 或回退到统一 path */}
          {pathContent.hasPressure && element.points && element.points.length > 1 ? (
            element.points.slice(1).map((pt, i) => {
              const prev = element.points![i];
              const avgPressure = ((prev.pressure || 0.5) + (pt.pressure || 0.5)) / 2;
              const w = (element.strokeWidth || 3) * avgPressure;
              return (
                <line key={i} x1={prev.x} y1={prev.y} x2={pt.x} y2={pt.y}
                  stroke={element.strokeColor || 'red'}
                  strokeWidth={Math.max(0.5, w)}
                  strokeLinecap="round"
                  style={{ pointerEvents: 'none' }}
                />
              );
            })
          ) : (
            <path
              d={pathContent.d}
              fill="none"
              stroke={element.strokeColor || "red"}
              strokeWidth={element.strokeWidth || 3}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: 'none' }}
            />
          )}
        </svg>
        {isSelected && (
          <div className="absolute inset-0 border-2 border-violet-500 pointer-events-none rounded-sm border-dashed opacity-50 export-ignore" />
        )}
        {resizeHandles}
      </div>
    );
  }

  return (
    <div
      data-element-id={element.id}
      onPointerDown={handleGeneralPointerDown}
      onPointerUp={handlePointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!isImage) onDoubleClick(element.id);
      }}
      style={containerStyle}
      className={`
        group rounded-sm no-touch
        ${isSelected
          ? 'ring-2 ring-violet-500 shadow-2xl'
          : 'hover:ring-2 hover:ring-violet-300 shadow-md'
        }
        ${isEditing ? 'ring-2 ring-violet-500' : (isDrawingMode ? '' : 'cursor-move')}
      `}
    >
      {isImage ? (
        <img
          src={element.content}
          alt={element.name}
          className="w-full h-full pointer-events-none block rounded-sm object-contain bg-gray-50/50"
        />
      ) : (
        <div className="w-full h-full bg-transparent overflow-hidden">
          {isEditing ? (
            <textarea
              ref={textareaRef}
              value={element.content}
              onChange={handleTextChange}
              onBlur={handleBlur}
              onFocus={handleFocus}
              onKeyDown={handleKeyDown}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-full h-full p-4 outline-none resize-none bg-transparent border-none shadow-none font-sans"
              style={{
                color: element.color || '#333333',
                fontSize: `${element.fontSize ?? 14}px`,
                lineHeight: element.lineHeight ?? 1.5,
                letterSpacing: `${element.letterSpacing || 0}px`,
                minHeight: '100%',
                height: 'auto',
                overflowY: 'hidden',
              }}
            />
          ) : (
            <div
              className="w-full h-full p-4 break-words select-none font-sans"
              style={{
                color: element.color || '#333333',
                fontSize: `${element.fontSize ?? 14}px`,
                lineHeight: element.lineHeight ?? 1.5,
                letterSpacing: `${element.letterSpacing || 0}px`
              }}
            >
              {element.content}
            </div>
          )}
        </div>
      )}

      {isSelected && !isEditing && (
        <div className={`absolute ${element.y < 30 ? 'top-1 left-1 rounded-sm' : '-top-6 left-0 rounded-t-sm'} bg-violet-600 text-white text-[10px] px-2 py-0.5 font-bold uppercase tracking-tighter shadow-sm pointer-events-none export-ignore`}>
          {element.type === 'image' ? '图片' : '文本'}
        </div>
      )}

      {resizeHandles}

      {isSelected && !isEditing && (
        <div className="absolute inset-0 pointer-events-none border-2 border-violet-500 rounded-sm export-ignore shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)]" />
      )}

      {!isSelected && !isEditing && !isDrawingMode && (
        <div className="absolute inset-0 pointer-events-none border border-violet-400 opacity-0 group-hover:opacity-40 rounded-sm export-ignore" />
      )}
    </div>
  );
}, (prev, next) => {
  return (
    prev.isSelected === next.isSelected &&
    prev.isEditing === next.isEditing &&
    prev.isDrawingMode === next.isDrawingMode &&
    prev.element.x === next.element.x &&
    prev.element.y === next.element.y &&
    prev.element.width === next.element.width &&
    prev.element.height === next.element.height &&
    prev.element.content === next.element.content &&
    prev.element.points === next.element.points &&
    prev.element.strokeWidth === next.element.strokeWidth &&
    prev.element.color === next.element.color &&
    prev.element.lineHeight === next.element.lineHeight &&
    prev.element.letterSpacing === next.element.letterSpacing &&
    prev.element.fontSize === next.element.fontSize
  );
});

export default CanvasElementComp;
