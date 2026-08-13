import React, { useState, useRef, useEffect } from 'react';
import { CanvasElement } from '../types';

interface TypographyPanelProps {
    elements: CanvasElement[];
    selectedIds: string[];
    onChange: (property: 'color' | 'lineHeight' | 'letterSpacing' | 'fontSize', value: string | number) => void;
    isDrawer?: boolean;
    onClose?: () => void;
    onDetach?: (startX?: number, startY?: number, pointerId?: number) => void;
    onDock?: () => void;
    initialDrag?: { startX: number; startY: number; pointerId: number } | null;
}

const TypographyPanel: React.FC<TypographyPanelProps> = ({
    elements, selectedIds, onChange, isDrawer = false, onClose, onDetach, onDock, initialDrag
}) => {
    const [isDocked, setIsDocked] = useState(true);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDraggingState, setIsDraggingState] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [startPos, setStartPos] = useState({ x: 0, y: 0 });
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isDrawer && initialDrag && panelRef.current) {
            setIsDraggingState(true);
            const rect = panelRef.current.getBoundingClientRect();
            setDragOffset({ x: rect.width / 2, y: 20 });
            setPosition({ x: initialDrag.startX - rect.width / 2, y: initialDrag.startY - 20 });
            try { if (initialDrag.pointerId) panelRef.current.setPointerCapture(initialDrag.pointerId); } catch (e) { }
        }
    }, [isDrawer, initialDrag]);

    const handleHeaderDown = (e: React.PointerEvent) => {
        setStartPos({ x: e.clientX, y: e.clientY });
        
        if (isDrawer) {
            setIsDraggingState(true);
            const rect = panelRef.current?.getBoundingClientRect();
            if (rect) setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        } else {
            setIsDraggingState(true);
            const rect = panelRef.current?.getBoundingClientRect();
            if (rect) setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handleHeaderMove = (e: React.PointerEvent) => {
        if (!isDraggingState) return;
        
        if (isDrawer) {
            const dx = e.clientX - startPos.x;
            const dy = e.clientY - startPos.y;
            if (Math.sqrt(dx * dx + dy * dy) > 10) {
                onDetach?.(e.clientX, e.clientY, e.pointerId);
                setIsDraggingState(false);
            }
            return;
        }

        const newX = e.clientX - dragOffset.x;
        const newY = e.clientY - dragOffset.y;
        const dockThreshold = 40;
        const shouldDock = window.innerWidth - (newX + (panelRef.current?.offsetWidth || 280)) < dockThreshold;
        setIsDocked(shouldDock);
        setPosition({ x: newX, y: newY });
    };

    const handleHeaderUp = (e: React.PointerEvent) => {
        setIsDraggingState(false);
        try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch (err) {}
    };

    useEffect(() => {
        if (isDrawer || !isDraggingState) return;
        const handleWinMove = (e: PointerEvent) => {
            const newX = e.clientX - dragOffset.x;
            const newY = e.clientY - dragOffset.y;
            const dockThreshold = 40;
            const shouldDock = window.innerWidth - (newX + (panelRef.current?.offsetWidth || 280)) < dockThreshold;
            setIsDocked(shouldDock);
            setPosition({ x: newX, y: newY });
        };
        const handleWinUp = (e: PointerEvent) => setIsDraggingState(false);
        window.addEventListener('pointermove', handleWinMove);
        window.addEventListener('pointerup', handleWinUp);
        return () => {
            window.removeEventListener('pointermove', handleWinMove);
            window.removeEventListener('pointerup', handleWinUp);
        };
    }, [isDrawer, isDraggingState, dragOffset]);

    const selectedEls = elements.filter(el => selectedIds.includes(el.id));
    const isVisible = selectedEls.length > 0 && selectedEls.every(el => el.type === 'text');

    if (!isVisible && !isDrawer) return null;

    const firstSelectedText = selectedEls[0];

    const panelContent = (
        <div ref={panelRef} className={`typography-panel-inner ${isDrawer ? 'w-[280px] max-h-[70vh] border-0 shadow-none' : 'w-[280px] m-4 rounded-2xl border border-violet-100 dark:border-violet-900/50 shadow-[0_16px_40px_rgba(0,0,0,0.1)] overflow-hidden'} bg-white/40 dark:bg-gray-900/40 flex flex-col pointer-events-auto transition-shadow duration-300 ${!isDrawer ? 'hover:shadow-[0_20px_50px_rgba(0,0,0,0.15)] bg-white/90 dark:bg-gray-900/90 backdrop-blur-md' : ''} ${isDraggingState && !isDrawer ? 'opacity-80 scale-[1.02] cursor-grabbing shadow-2xl ring-2 ring-violet-500/50' : ''}`}
            style={isDrawer ? {} : (isDocked && !isDraggingState ? {
                position: 'absolute',
                top: '50%',
                right: '24px',
                transform: `translateY(-50%)`,
                transition: 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
            } : {
                position: 'fixed',
                left: `${position.x}px`,
                top: `${position.y}px`,
                transition: isDraggingState ? 'none' : 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
                touchAction: 'none',
                zIndex: isDraggingState ? 9999 : 40
            })}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => {
                e.stopPropagation();
                if (isDraggingState && !isDrawer && e.target === panelRef.current) {
                    handleHeaderMove(e);
                }
            }}
            onPointerUp={(e) => {
                e.stopPropagation();
                if (isDraggingState && !isDrawer && e.target === panelRef.current) {
                    handleHeaderUp(e);
                }
            }}
        >
            <div
                className={`flex items-center justify-between p-4 border-b border-gray-50 dark:border-gray-800 cursor-grab active:cursor-grabbing select-none`}
                style={{ touchAction: 'none' }}
                onPointerDown={handleHeaderDown}
                onPointerMove={handleHeaderMove}
                onPointerUp={handleHeaderUp}
                onPointerCancel={handleHeaderUp}
            >
                <h3 className="text-xs font-black text-gray-800 dark:text-gray-100 uppercase tracking-widest flex items-center gap-1.5 pointer-events-none select-none">
                    <i className="fa-solid fa-font text-violet-500 dark:text-violet-400"></i>排版控制
                </h3>
                <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
                    {isDrawer && (
                        <button onClick={() => onDetach?.()} className="text-gray-400 dark:text-gray-500 hover:text-blue-500 transition-colors pointer-events-auto p-1.5" title="自由挪动">
                            <i className="fa-solid fa-up-right-from-square text-[10px]"></i>
                        </button>
                    )}
                    {!isDrawer && (
                        <button onClick={onDock} className="text-gray-400 dark:text-gray-500 hover:text-violet-500 transition-colors pointer-events-auto p-1.5" title="收纳进停靠栏">
                            <i className="fa-solid fa-right-to-bracket text-[10px]"></i>
                        </button>
                    )}
                    {onClose && (
                        <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors pointer-events-auto p-1.5">
                            <i className="fa-solid fa-xmark text-sm"></i>
                        </button>
                    )}
                </div>
            </div>

            <div className={`space-y-5 p-4 ${isDrawer ? 'overflow-y-auto' : ''}`}>
                {/* Color */}
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><i className="fa-solid fa-palette w-3 text-center"></i>颜色</span>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={firstSelectedText?.color || '#333333'}
                            onChange={(e) => onChange('color', e.target.value)}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="w-16 text-xs text-center font-mono border border-gray-200 dark:border-gray-700 rounded py-1 text-gray-600 dark:text-gray-300 focus:outline-none focus:border-violet-400 uppercase bg-white/50 dark:bg-gray-900/50 hover:bg-white transition-colors"
                        />
                        <input
                            type="color"
                            value={firstSelectedText?.color || '#333333'}
                            onChange={(e) => onChange('color', e.target.value)}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            className="w-8 h-8 rounded cursor-pointer border-0 shadow-inner overflow-hidden flex-shrink-0 p-0"
                        />
                    </div>
                </div>

                {/* Font Size */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><i className="fa-solid fa-text-height w-3 text-center"></i>字号</span>
                        <span className="text-xs font-mono text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 px-1.5 py-0.5 rounded shadow-sm">
                            {firstSelectedText?.fontSize ?? 14}px
                        </span>
                    </div>
                    <input
                        type="range"
                        min="8"
                        max="72"
                        step="1"
                        value={firstSelectedText?.fontSize ?? 14}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) => onChange('fontSize', parseInt(e.target.value))}
                        className="w-full h-1.5 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-violet-600 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                        style={{
                            background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${((firstSelectedText?.fontSize ?? 14) - 8) / (72 - 8) * 100}%, #e5e7eb ${((firstSelectedText?.fontSize ?? 14) - 8) / (72 - 8) * 100}%, #e5e7eb 100%)`
                        }}
                    />
                </div>

                {/* Line Height */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><i className="fa-solid fa-arrows-up-down w-3 text-center"></i>行高</span>
                        <span className="text-xs font-mono text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 px-1.5 py-0.5 rounded shadow-sm">
                            {firstSelectedText?.lineHeight || 1.5}
                        </span>
                    </div>
                    <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.1"
                        value={firstSelectedText?.lineHeight || 1.5}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) => onChange('lineHeight', parseFloat(e.target.value))}
                        className="w-full h-1.5 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-violet-600 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                        style={{
                            background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${((firstSelectedText?.lineHeight || 1.5) - 1) / (3 - 1) * 100}%, #e5e7eb ${((firstSelectedText?.lineHeight || 1.5) - 1) / (3 - 1) * 100}%, #e5e7eb 100%)`
                        }}
                    />
                </div>

                {/* Letter Spacing */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><i className="fa-solid fa-text-width w-3 text-center"></i>字距</span>
                        <span className="text-xs font-mono text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 px-1.5 py-0.5 rounded shadow-sm">
                            {firstSelectedText?.letterSpacing || 0}px
                        </span>
                    </div>
                    <input
                        type="range"
                        min="-5"
                        max="15"
                        step="1"
                        value={firstSelectedText?.letterSpacing || 0}
                        onPointerDown={(e) => e.stopPropagation()}
                        onChange={(e) => onChange('letterSpacing', parseInt(e.target.value))}
                        className="w-full h-1.5 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:bg-violet-600 [&::-webkit-slider-thumb]:rounded-full hover:[&::-webkit-slider-thumb]:scale-110 transition-all"
                        style={{
                            background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${((firstSelectedText?.letterSpacing || 0) - -5) / (15 - -5) * 100}%, #e5e7eb ${((firstSelectedText?.letterSpacing || 0) - -5) / (15 - -5) * 100}%, #e5e7eb 100%)`
                        }}
                    />
                </div>
            </div>
        </div>
    );

    return isDrawer ? panelContent : (
        <div className={`typography-panel-root absolute z-40 ${isDocked && !isDraggingState ? 'right-[72px]' : ''}`}>
            {panelContent}
            {!isDrawer && isDraggingState && isDocked && (
                <div className="fixed top-1/2 right-[72px] -translate-y-1/2 w-[280px] h-[300px] border-2 border-violet-500/50 dark:border-violet-500/50 bg-violet-100/20 dark:bg-violet-900/20 rounded-2xl shadow-[0_0_30px_rgba(139,92,246,0.2)] pointer-events-none z-[-1] transition-all duration-300 backdrop-blur-sm">
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-violet-600 dark:bg-violet-600 text-white text-xs font-bold px-4 py-2 rounded-full uppercase tracking-widest animate-bounce shadow-lg">
                            松开以停靠 <i className="fa-solid fa-magnet ml-1"></i>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TypographyPanel;
