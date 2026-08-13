export type ToolMode = 'select' | 'draw';
export type ElementType = 'image' | 'text' | 'path';

export interface CanvasElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string; // URL for images, text for text boxes, or metadata for paths
  name: string;    // Filename or title
  zIndex: number;
  points?: { x: number; y: number; pressure?: number }[]; // Coordinates for path segments
  strokeColor?: string;               // Color for the path
  strokeWidth?: number;               // Line width for the path
  color?: string;                     // Text color
  lineHeight?: number;                // Text line height equivalent
  letterSpacing?: number;             // Text letter spacing in px
  fontSize?: number;                  // Text font size in px (default: 14)
  sourceResolution?: { width: number; height: number }; // AI 生图的真实输出像素尺寸（画布上的 width/height 只是显示大小，不等于这个）
}

export interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AlignmentGuide {
  type: 'vertical' | 'horizontal';
  pos: number; // The coordinate on the axis
}
