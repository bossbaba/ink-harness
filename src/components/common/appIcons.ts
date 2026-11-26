/**
 * 应用图标的单一来源：一组 16×16 描边路径，风格对齐 macOS SF Symbols。
 *
 * 之前侧栏、标题栏、编辑器里散落着「◫ ☾ ↩ ✓」等字符图标，字形随系统字体漂移、
 * 粗细也不统一。这里集中定义语义图标，组件用 currentColor 渲染，明暗主题自动适配。
 * 新增图标只要在这里加一条 name → path[]，调用方无需关心具体路径。
 */
export type AppIconName =
  | "workspace"
  | "bible"
  | "stats"
  | "models"
  | "ideation"
  | "outline"
  | "write"
  | "review"
  | "publish"
  | "workflow"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "moon"
  | "sun"
  | "focus"
  | "check"
  | "plus"
  | "close"
  | "search"
  | "undo"
  | "redo"
  // ↓ 设计稿新增语义图标（24×24 填充/描边混合，见 designIconShapes.ts）
  | "back"
  | "agentRole"
  | "agentEval"
  | "mcp"
  | "settings"
  | "theme"
  | "person"
  | "location"
  | "organization"
  | "timeline"
  | "glossary";

/** 每条路径都是可独立 stroke 的线段；圆与圆弧用 path 的 A 指令表达，避免混用元素类型。 */
export const appIconPaths: Record<AppIconName, string[]> = {
  workspace: ["M2.5 2.5h11v11h-11z", "M2.5 6.5h11", "M6.5 6.5v7"],
  bible: ["M3.5 3h6.5a2 2 0 0 1 2 2v8H5.5a2 2 0 0 1-2-2z", "M12 5h1.5v8H5.5"],
  stats: ["M2.5 13.5h11", "M4.5 13V9", "M8 13V4", "M11.5 13v-6"],
  models: ["M5.5 5.5h5v5h-5z", "M8 2.5v3", "M8 10.5v3", "M2.5 8h3", "M10.5 8h3"],
  ideation: [
    "M7.5 2.5l1.2 3.1 3.1 1.2-3.1 1.2-1.2 3.1-1.2-3.1L3.2 6.8l3.1-1.2z",
    "M12 10.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z",
  ],
  outline: ["M6 4.5h7", "M6 8h7", "M6 11.5h7", "M3.2 4.5h.01", "M3.2 8h.01", "M3.2 11.5h.01"],
  write: ["M11.7 3.3l1 1-7.6 7.6-2.1.5.5-2.1z", "M10.7 4.3l1 1"],
  review: ["M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M9.8 9.8l3.2 3.2"],
  publish: [
    "M8 10V3",
    "M5.5 5.5L8 3l2.5 2.5",
    "M3 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12v-1.5",
  ],
  workflow: ["M3 5h7", "M8 3l2 2-2 2", "M13 11H6", "M8 9l-2 2 2 2"],
  "chevron-left": ["M10 3l-5 5 5 5"],
  "chevron-right": ["M6 3l5 5-5 5"],
  "chevron-down": ["M3 6l5 5 5-5"],
  moon: ["M13 10.5A5.5 5.5 0 0 1 5.5 3 5.5 5.5 0 1 0 13 10.5z"],
  sun: [
    "M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z",
    "M8 1.5v1.3",
    "M8 13.2v1.3",
    "M1.5 8h1.3",
    "M13.2 8h1.3",
    "M3.4 3.4l.9.9",
    "M11.7 11.7l.9.9",
    "M12.6 3.4l-.9.9",
    "M4.3 11.7l-.9.9",
  ],
  focus: [
    "M3 6V4.5A1.5 1.5 0 0 1 4.5 3H6",
    "M10 3h1.5A1.5 1.5 0 0 1 13 4.5V6",
    "M13 10v1.5a1.5 1.5 0 0 1-1.5 1.5H10",
    "M6 13H4.5A1.5 1.5 0 0 1 3 11.5V10",
    "M8 7.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z",
  ],
  check: ["M3 8.5l3 3 7-7"],
  plus: ["M8 3v10", "M3 8h10"],
  close: ["M4 4l8 8", "M12 4l-8 8"],
  search: ["M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M9.8 9.8l3.2 3.2"],
  undo: ["M6 5L3 8l3 3", "M3 8h6a3 3 0 0 1 0 6H7"],
  redo: ["M10 5l3 3-3 3", "M13 8H7a3 3 0 0 0 0 6h2"],
  // 设计稿新增图标的路径在这里留空占位：它们由 designIconShapes.ts 的 24×24 矢量渲染，
  // 保留键名只为让 Record<AppIconName, string[]> 的类型约束完整，实际不会走到这里。
  back: [],
  agentRole: [],
  agentEval: [],
  mcp: [],
  settings: [],
  theme: [],
  person: [],
  location: [],
  organization: [],
  timeline: [],
  glossary: [],
};
