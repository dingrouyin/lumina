import React, { useState } from 'react';

interface RightDockProps {
    activeDrawer: 'layers' | 'typography' | null;
    dockedPanels: string[];
    onToggle: (drawer: 'layers' | 'typography') => void;
    hasSelection: boolean;
    onShowToast?: (msg: string) => void;
    isDarkMode: boolean;
    onToggleTheme: () => void;
    showAIImagePanel: boolean;
    onToggleAIImagePanel: () => void;
}

const RightDock: React.FC<RightDockProps> = ({ activeDrawer, dockedPanels, onToggle, hasSelection, onShowToast, isDarkMode, onToggleTheme, showAIImagePanel, onToggleAIImagePanel }) => {
    return (
        <aside className="w-16 h-full flex flex-col items-center justify-between bg-white dark:bg-gray-900 border-l border-gray-100 dark:border-gray-800 shadow-sm relative z-[45] shrink-0 select-none overflow-y-auto">
            {/* Top group: 素材 + 模板 */}
            <div className="flex flex-col gap-2 w-full items-center pt-4 pb-2">
                <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); onShowToast?.('素材库 / 组件功能建设中，敬请期待'); }}
                    className="w-12 h-12 flex flex-col gap-1 items-center justify-center rounded-xl transition-all duration-300 text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:text-gray-500 dark:hover:text-violet-400 dark:hover:bg-violet-900/30 focus:ring-0 focus:outline-none"
                    title="素材库 / 组件（建设中）"
                >
                    <i className="fa-solid fa-border-all text-sm pointer-events-none"></i>
                    <span className="text-[9px] font-bold pointer-events-none tracking-widest leading-none">素材</span>
                </button>
                <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); onShowToast?.('模板中心建设中，敬请期待'); }}
                    className="w-12 h-12 flex flex-col gap-1 items-center justify-center rounded-xl transition-all duration-300 text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:text-gray-500 dark:hover:text-violet-400 dark:hover:bg-violet-900/30 focus:ring-0 focus:outline-none"
                    title="模板中心（建设中）"
                >
                    <i className="fa-solid fa-shapes text-sm pointer-events-none"></i>
                    <span className="text-[9px] font-bold pointer-events-none tracking-widest leading-none">模板</span>
                </button>
            </div>

            <div className="w-6 h-px bg-gray-100 dark:bg-gray-800 shrink-0"></div>

            {/* Middle group: 图层 + 文字 */}
            <div className="flex flex-col gap-2 w-full items-center py-2">
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggle('layers'); }}
                    className={`w-12 h-12 flex flex-col gap-1 items-center justify-center rounded-xl transition-all duration-300 focus:ring-0 focus:outline-none ${activeDrawer === 'layers'
                        ? 'bg-violet-600 text-white shadow-lg shadow-violet-200 dark:shadow-violet-950/50'
                        : 'text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:text-gray-500 dark:hover:text-violet-400 dark:hover:bg-violet-900/30'
                        }`}
                    title="图层管理"
                >
                    <i className="fa-solid fa-layer-group text-sm pointer-events-none"></i>
                    <span className="text-[9px] font-bold pointer-events-none tracking-widest leading-none">图层</span>
                </button>
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggle('typography'); }}
                    className={`w-12 h-12 flex flex-col gap-1 items-center justify-center rounded-xl transition-all duration-300 focus:ring-0 focus:outline-none ${activeDrawer === 'typography'
                        ? 'bg-violet-600 text-white shadow-lg shadow-violet-200 dark:shadow-violet-950/50'
                        : 'text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:text-gray-500 dark:hover:text-violet-400 dark:hover:bg-violet-900/30'
                        }`}
                    title="文字工具"
                >
                    <i className="fa-solid fa-font text-sm pointer-events-none"></i>
                    <span className="text-[9px] font-bold pointer-events-none tracking-widest leading-none">文字</span>
                </button>
            </div>

            <div className="w-6 h-px bg-gray-100 dark:bg-gray-800 shrink-0"></div>

            {/* AI 生图（原悬浮工具栏里的"AI 生图"按钮，移到这里常驻） */}
            <div className="flex flex-col gap-2 w-full items-center py-2">
                <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleAIImagePanel(); }}
                    className={`w-12 h-12 flex flex-col gap-1 items-center justify-center rounded-xl transition-all duration-300 focus:ring-0 focus:outline-none ${showAIImagePanel
                        ? 'bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-lg shadow-violet-200 dark:shadow-violet-950/50'
                        : 'text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:text-gray-500 dark:hover:text-violet-400 dark:hover:bg-violet-900/30'
                        }`}
                    title="AI 生图（Imagen 3）"
                >
                    <i className="fa-solid fa-wand-magic-sparkles text-sm pointer-events-none"></i>
                    <span className="text-[9px] font-bold pointer-events-none tracking-widest leading-none">生图</span>
                </button>
            </div>

            <div className="w-6 h-px bg-gray-100 dark:bg-gray-800 shrink-0"></div>

            {/* Bottom group: 主题 + 设置 + AI工具 */}
            <div className="flex flex-col gap-2 w-full items-center pt-2 pb-4">
                <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleTheme(); }}
                    className="w-12 h-12 flex flex-col gap-1 items-center justify-center rounded-xl transition-all duration-300 text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:text-gray-500 dark:hover:text-violet-400 dark:hover:bg-violet-900/30 focus:ring-0 focus:outline-none"
                    title={isDarkMode ? '切换到白天模式' : '切换到暗夜模式'}
                >
                    <i className={`fa-solid ${isDarkMode ? 'fa-sun' : 'fa-moon'} text-sm pointer-events-none`}></i>
                    <span className="text-[9px] font-bold pointer-events-none tracking-widest leading-none">{isDarkMode ? '白天' : '暗夜'}</span>
                </button>
                <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); onShowToast?.('画布设置 / 快捷键说明建设中'); }}
                    className="w-12 h-12 flex flex-col gap-1 items-center justify-center rounded-xl transition-all duration-300 text-gray-400 hover:text-violet-600 hover:bg-violet-50 dark:text-gray-500 dark:hover:text-violet-400 dark:hover:bg-violet-900/30 focus:ring-0 focus:outline-none"
                    title="设置与画布信息"
                >
                    <i className="fa-solid fa-circle-info text-sm pointer-events-none"></i>
                    <span className="text-[9px] font-bold pointer-events-none tracking-widest leading-none">设置</span>
                </button>
                <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); onShowToast?.('AI 快捷入口（一键抠图/扩图）建设中，敬请期待'); }}
                    className="w-12 h-12 flex flex-col gap-1 items-center justify-center rounded-xl transition-all duration-300 text-violet-400 hover:text-violet-600 border hover:border-violet-200 border-transparent shadow-sm bg-violet-50 hover:bg-violet-100 dark:text-violet-400 dark:hover:text-violet-300 dark:hover:border-violet-800 dark:bg-violet-900/30 dark:hover:bg-violet-900/50 focus:ring-0 focus:outline-none"
                    title="AI 快捷入口 (一键抠图/扩图)"
                >
                    <i className="fa-solid fa-wand-magic-sparkles text-sm pointer-events-none"></i>
                    <span className="text-[9px] font-bold pointer-events-none tracking-widest leading-none">AI工具</span>
                </button>
            </div>
        </aside>
    );
};

export default RightDock;

