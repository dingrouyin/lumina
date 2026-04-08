import React, { useState, useRef, useCallback, useEffect } from 'react';
import { CanvasElement } from '../types';

interface LayerPanelProps {
    elements: CanvasElement[];
    selectedIds: string[];
    onSelectElement: (id: string, isShift: boolean) => void;
    onMoveElement: (id: string, direction: 'up' | 'down') => void;
    onRenameElement: (id: string, name: string) => void;
    onDeleteElement?: (id: string) => void;
    isDrawer?: boolean;
    onClose?: () => void;
    onDetach?: (startX?: number, startY?: number, pointerId?: number) => void;
    onDock?: () => void;
    initialDrag?: { startX: number; startY: number; pointerId: number } | null;
}

const LayerPanel: React.FC<LayerPanelProps> = ({
    elements, selectedIds, onSelectElement, onMoveElement, onRenameElement, onDeleteElement, isDrawer = false, onClose, onDetach, onDock, initialDrag
}) => {
    const [isDocked, setIsDocked] = useState(true);
    const [isExpanded, setIsExpanded] = useState(true);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDraggingState, setIsDraggingState] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const [editingNameId, setEditingNameId] = useState<string | null>(null);
    const [editingNameValue, setEditingNameValue] = useState('');
    const panelRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);

    // Provide seamless drag hand-off when panel converts from drawer to floating
    useEffect(() => {
        if (!isDrawer && initialDrag && panelRef.current) {
            setIsDraggingState(true);
            const rect = panelRef.current.getBoundingClientRect();
            // Estimate drag offset assuming user grabbed the top header center
            setDragOffset({
                x: rect.width / 2,
                y: 20
            });
            setPosition({
                x: initialDrag.startX - rect.width / 2,
                y: initialDrag.startY - 20
            });

            // Try to capture pointer if possible, though window events handle the rest
            try {
                if (initialDrag.pointerId) {
                    panelRef.current.setPointerCapture(initialDrag.pointerId);
                }
            } catch (e) { }
        }
    }, [isDrawer, initialDrag]);

    const stopPropagation = (e: React.PointerEvent | React.WheelEvent | React.KeyboardEvent) => {
        e.stopPropagation();
    };

    const startEditName = (id: string, currentName: string) => {
        setEditingNameId(id);
        setEditingNameValue(currentName);
        setTimeout(() => nameInputRef.current?.select(), 0);
    };

    const commitEditName = () => {
        if (editingNameId && editingNameValue.trim()) {
            onRenameElement(editingNameId, editingNameValue.trim());
        }
        setEditingNameId(null);
    };

    const cancelEditName = () => setEditingNameId(null);

    const handlePointerDown = (e: React.PointerEvent) => {
        setStartPos({ x: e.clientX, y: e.clientY });

        if (isDrawer) {
            setIsDraggingState(true);
            const rect = panelRef.current?.getBoundingClientRect();
            if (rect) {
                setDragOffset({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top
                });
            }
        } else {
            setIsDraggingState(true);
            const rect = panelRef.current?.getBoundingClientRect();
            if (rect) {
                setDragOffset({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top
                });
            }
        }
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDraggingState) return;

        if (isDrawer) {
            const dx = e.clientX - startPos.x;
            const dy = e.clientY - startPos.y;
            if (Math.sqrt(dx * dx + dy * dy) > 10 && onDetach) {
                onDetach(e.clientX, e.clientY, e.pointerId);
                setIsDraggingState(false);
            }
            return;
        }

        const newX = e.clientX - dragOffset.x;
        const newY = e.clientY - dragOffset.y;

        const dockThreshold = 40;
        const shouldDock = window.innerWidth - (newX + (panelRef.current?.offsetWidth || 260)) < dockThreshold;

        setIsDocked(shouldDock);
        setPosition({ x: newX, y: newY });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!isDrawer) {
            setIsDraggingState(false);
            try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch (e) { }
        } else {
            setIsDraggingState(false);
            try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch (e) { }
        }
    };

    // Use window events for robust dragging when floating
    useEffect(() => {
        if (isDrawer || !isDraggingState) return;

        const handleWinMove = (e: PointerEvent) => {
            const newX = e.clientX - dragOffset.x;
            const newY = e.clientY - dragOffset.y;
            const dockThreshold = 40;
            const shouldDock = window.innerWidth - (newX + (panelRef.current?.offsetWidth || 260)) < dockThreshold;
            setIsDocked(shouldDock);
            setPosition({ x: newX, y: newY });

            // If dragging near the dock area, show a translucent docking placeholder indicator
            // (Handled implicitly by CSS transform & opacity in rendering below, but could trigger state here if needed)
        };

        const handleWinUp = (e: PointerEvent) => {
            setIsDraggingState(false);
        };

        window.addEventListener('pointermove', handleWinMove);
        window.addEventListener('pointerup', handleWinUp);
        return () => {
            window.removeEventListener('pointermove', handleWinMove);
            window.removeEventListener('pointerup', handleWinUp);
        };
    }, [isDrawer, isDraggingState, dragOffset]);

    const panelContent = (
        <div
            ref={panelRef}
            className={`layer-panel-inner ${isDrawer ? 'w-fit min-w-[240px] max-w-[360px]' : 'w-fit min-w-[240px] max-w-[360px] m-4'} flex flex-col bg-white/40 ${isDrawer ? '' : 'border border-white/60 shadow-[0_16px_40px_rgba(0,0,0,0.1)] rounded-2xl'} overflow-hidden pointer-events-auto transition-shadow duration-300 hover:shadow-[0_20px_50px_rgba(0,0,0,0.15)] ${isDraggingState ? 'opacity-80 scale-[1.02] cursor-grabbing shadow-2xl ring-2 ring-violet-500/50' : ''}`}
            style={isDrawer ? { maxHeight: '75vh' } : (isDocked && !isDraggingState ? {
                position: 'absolute',
                top: '50%',
                right: '24px',
                transform: `translateY(-50%) ${isExpanded ? '' : 'translateX(calc(100% - 40px))'}`,
                transition: 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
            } : {
                position: 'fixed',
                left: `${position.x}px`,
                top: `${position.y}px`,
                transition: isDraggingState ? 'none' : 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
                touchAction: 'none',
                zIndex: isDraggingState ? 9999 : 40
            })}
            onPointerDown={stopPropagation}
            onPointerMove={(e) => {
                stopPropagation(e);
                if (isDraggingState && !isDrawer && e.target === panelRef.current) {
                    handlePointerMove(e);
                }
            }}
            onPointerUp={(e) => {
                stopPropagation(e);
                if (isDraggingState && !isDrawer && e.target === panelRef.current) {
                    handlePointerUp(e);
                }
            }}
            onWheel={stopPropagation}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
        >
            <div
                className={`p-4 border-b border-gray-200/50 flex items-center justify-between shrink-0 bg-white/40 cursor-grab active:cursor-grabbing`}
                style={{ touchAction: 'none' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest flex items-center gap-2 select-none pointer-events-none">
                    <i className="fa-solid fa-layer-group text-violet-500"></i>
                    图层
                </h3>
                <div className="flex items-center gap-2" onPointerDown={stopPropagation}>
                    {isDrawer && (
                        <button onClick={() => onDetach?.()} className="text-gray-400 hover:text-blue-500 transition-colors pointer-events-auto p-1.5" title="自由挪动">
                            <i className="fa-solid fa-up-right-from-square text-[10px]"></i>
                        </button>
                    )}
                    {!isDrawer && (
                        <button onClick={onDock} className="text-gray-400 hover:text-violet-500 transition-colors pointer-events-auto p-1.5" title="收纳进停靠栏">
                            <i className="fa-solid fa-right-to-bracket text-[10px]"></i>
                        </button>
                    )}
                    {onClose && (
                        <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition-colors pointer-events-auto p-1.5" title="收起面板">
                            <i className="fa-solid fa-xmark text-sm"></i>
                        </button>
                    )}
                    {!isDrawer && isDocked && (
                        <button onClick={() => setIsExpanded(false)} className="text-gray-400 hover:text-violet-500 transition-colors pointer-events-auto" title="收起贴边">
                            <i className="fa-solid fa-chevron-right text-xs"></i>
                        </button>
                    )}
                    {!isDrawer && <i className="fa-solid fa-up-down-left-right text-gray-400 text-[10px] pointer-events-none" title="拖拽移动面板"></i>}
                </div>
            </div>

            <div className="flex-grow overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {elements.length === 0 ? (
                    <div className="h-20 flex flex-col items-center justify-center text-gray-400 gap-2 opacity-50">
                        <i className="fa-solid fa-box-open text-xl"></i>
                        <span className="text-[10px] font-bold uppercase tracking-tighter">无图层数据</span>
                    </div>
                ) : (
                    [...elements].reverse().map((el, index) => {
                        const isSelected = selectedIds.includes(el.id);
                        return (
                            <div
                                key={el.id}
                                className={`group flex items-center gap-3 p-2 rounded-xl transition-all duration-200 cursor-pointer border ${isSelected
                                    ? 'bg-violet-50 border-violet-200 shadow-sm'
                                    : 'bg-white/40 border-transparent hover:bg-violet-50/50 hover:border-violet-100'
                                    }`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectElement(el.id, e.shiftKey);
                                }}
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm border ${isSelected ? 'bg-white border-violet-200' : 'bg-gray-50 border-gray-100'}`}>
                                    {el.type === 'image' ? (
                                        <div className="w-full h-full p-1">
                                            <img src={el.content} className="w-full h-full object-cover rounded shadow-inner" alt="" />
                                        </div>
                                    ) : el.type === 'text' ? (
                                        <i className="fa-solid fa-font text-violet-400 text-xs"></i>
                                    ) : (
                                        <i className="fa-solid fa-pen-nib text-violet-400 text-xs"></i>
                                    )}
                                </div>

                                <div className="flex-grow min-w-0">
                                    {editingNameId === el.id ? (
                                        <input
                                            ref={nameInputRef}
                                            type="text"
                                            value={editingNameValue}
                                            onChange={(e) => setEditingNameValue(e.target.value)}
                                            onBlur={commitEditName}
                                            onKeyDown={(e) => {
                                                e.stopPropagation();
                                                if (e.key === 'Enter') { e.preventDefault(); commitEditName(); }
                                                if (e.key === 'Escape') { e.preventDefault(); cancelEditName(); }
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            onPointerDown={(e) => e.stopPropagation()}
                                            autoFocus
                                            className="w-full text-[11px] font-bold text-violet-900 bg-white border border-violet-400 rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-violet-400"
                                        />
                                    ) : (
                                        <div
                                            className={`text-[11px] font-bold truncate transition-colors cursor-text ${isSelected ? 'text-violet-900' : 'text-gray-700'}`}
                                            title={`${el.name} — 双击重命名`}
                                            onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                const displayName = (!el.name || el.name === el.id || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(el.name))
                                                    ? (el.type === 'image' ? '图片素材' : el.type === 'text' ? '文本内容' : '绘画路径')
                                                    : el.name;
                                                startEditName(el.id, displayName);
                                            }}
                                        >
                                            {(!el.name || el.name === el.id || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(el.name) || el.name.includes('失显'))
                                                ? (el.type === 'image' ? '图片素材' : el.type === 'text' ? '文本内容' : '绘画路径')
                                                : el.name}
                                        </div>
                                    )}
                                    <div className="text-[9px] text-gray-400 font-medium uppercase tracking-widest opacity-60">
                                        {el.type === 'image' ? '位图素材' : el.type === 'text' ? '文字内容' : '路径矢量'}
                                    </div>
                                </div>

                                <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isSelected ? 'opacity-100' : ''}`}>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); if (index > 0) onMoveElement(el.id, 'up'); }}
                                        title="上移图层（置于顶层方向）"
                                        className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${index === 0
                                            ? 'invisible'
                                            : 'bg-gray-50 hover:bg-violet-100 hover:text-violet-600 text-gray-400'
                                            }`}
                                    >
                                        <i className="fa-solid fa-arrow-up text-[10px]"></i>
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); if (index < elements.length - 1) onMoveElement(el.id, 'down'); }}
                                        title="下移图层（置于底层方向）"
                                        className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${index === elements.length - 1
                                            ? 'invisible'
                                            : 'bg-gray-50 hover:bg-violet-100 hover:text-violet-600 text-gray-400'
                                            }`}
                                    >
                                        <i className="fa-solid fa-arrow-down text-[10px]"></i>
                                    </button>
                                    {onDeleteElement && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onDeleteElement(el.id); }}
                                            title="删除图层"
                                            className="w-6 h-6 flex items-center justify-center rounded transition-colors bg-gray-50 hover:bg-red-100 hover:text-red-500 text-gray-400"
                                        >
                                            <i className="fa-solid fa-trash text-[10px]"></i>
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );

    return isDrawer ? panelContent : (
        <div className={`layer-panel-root absolute z-40 ${isDocked && !isDraggingState ? 'right-[72px]' : ''}`}>
            {panelContent}
            {/* When dragging to dock, show a magnet placeholder hint 
                if close to the dock trigger area */}
            {!isDrawer && isDraggingState && isDocked && (
                <div className="fixed top-1/2 right-[72px] -translate-y-1/2 w-[260px] h-[400px] border-2 border-violet-500/50 bg-violet-100/20 rounded-2xl shadow-[0_0_30px_rgba(139,92,246,0.2)] pointer-events-none z-[-1] transition-all duration-300 backdrop-blur-sm">
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-violet-600 text-white text-xs font-bold px-4 py-2 rounded-full uppercase tracking-widest animate-bounce shadow-lg">
                            松开以停靠 <i className="fa-solid fa-magnet ml-1"></i>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LayerPanel;
