import type { GlobalThemeOverrides } from "naive-ui";

/**
 * 颜色单一真源。所有语义色只在此定义一次：
 * - 运行时注入到 CSS 自定义属性（供 Sass 组件通过 var(--*) 使用）
 * - 派生 Naive UI 的 themeOverrides（CSS-in-JS 无法读 CSS 变量）
 * 主色取 Ardot 设计稿的墨绿：浅色 #0a8a4b / 深色 #3ddc91，保证正文与按钮上的对比度。
 */

export interface Palette {
  accent: string;
  accentHover: string;
  accentPressed: string;
  /** 深绿：设计稿次级强调色，用于渐变末端、装饰块与深色文字强调。 */
  accentDeep: string;
  success: string;
  warning: string;
  error: string;
  bgApp: string;
  bgSurface: string;
  /** 表单控件底色：设计稿下拉框 #F8F7F1，比卡面略深，保证控件边界可见。 */
  bgControl: string;
  bgSunken: string;
  /** 抬升表面：悬浮卡片与浮层底色，比普通 surface 再亮一层。 */
  bgElevated: string;
  /** 主色上的前景色：深色主题主色更亮，需要深色文字才清晰。 */
  onAccent: string;
  /** 悬停底色：列表项/菜单项 hover 用，明暗主题差异很大，必须走变量。 */
  bgHover: string;
  /** 主色的低饱和衬底：图标底色、选中态背景。 */
  accentSoft: string;
  /** 比 accentSoft 再实一档的选中底色，对应设计稿 #E4F0E8。 */
  accentSoftStrong: string;
  /** 侧栏底色：设计稿浅色侧栏比内容纸底略深一档。 */
  sidebarBg: string;
  /** 错误色的低饱和衬底：错误提示块背景。 */
  errorSoft: string;
  /** 成功色的低饱和衬底：成功提示块背景。 */
  successSoft: string;
  textPrimary: string;
  textSoft: string;
  /** 设计稿正文灰 #6A7168：页头说明与区块描述等长句用，比 textSoft 更轻。 */
  textMuted: string;
  textFaint: string;
  border: string;
  divider: string;
  /** 表单控件描边：暗色下必须比卡面亮一档，否则输入框看起来没有边框。 */
  controlBorder: string;
  /** 表单控件 hover 描边：比常态再亮一点，给可输入区域明确反馈。 */
  controlBorderHover: string;
}

export const palettes: Record<"light" | "dark", Palette> = {
  light: {
    // 与 Ardot 设计稿「浅色 · 纸墨」取色一致；主题家族仍是墨绿，没有换色系。
    accent: "#0a8a4b",
    accentHover: "#0e9c56",
    accentPressed: "#076b3b",
    accentDeep: "#076b3b",
    success: "#00897b",
    warning: "#e8a317",
    error: "#d4342a",
    bgApp: "#f5f3ec",
    bgSurface: "#fffdf7",
    // Ardot「下拉」节点填充色：无描边控件靠这层底色与卡面区分。
    bgControl: "#f8f7f1",
    bgSunken: "#f0eee6",
    bgElevated: "#ffffff",
    onAccent: "#ffffff",
    bgHover: "rgba(35, 41, 31, 0.06)",
    accentSoft: "#e8f3ec",
    accentSoftStrong: "#e4f0e8",
    sidebarBg: "#f0eee6",
    errorSoft: "rgba(212, 52, 42, 0.10)",
    successSoft: "rgba(0, 137, 123, 0.10)",
    textPrimary: "#23291f",
    textSoft: "#5d655c",
    textMuted: "#6a7168",
    textFaint: "#90998e",
    border: "#e6e3d8",
    divider: "rgba(35, 41, 31, 0.1)",
    // 浅色沿用设计稿边框 #E6E3D8，保持现有观感不变。
    controlBorder: "#e6e3d8",
    controlBorderHover: "#c9c4b6",
  },
  dark: {
    accent: "#3ddc91",
    accentHover: "#5ce6a6",
    accentPressed: "#2bc67f",
    accentDeep: "#2bc67f",
    success: "#26a69a",
    warning: "#f0b429",
    error: "#ef5350",
    bgApp: "#1c1b1a",
    bgSurface: "#262422",
    bgControl: "#2f2c29",
    bgSunken: "#141312",
    bgElevated: "#2f2c29",
    onAccent: "#0c2018",
    bgHover: "rgba(236, 233, 226, 0.08)",
    accentSoft: "rgba(61, 220, 145, 0.14)",
    accentSoftStrong: "rgba(61, 220, 145, 0.2)",
    sidebarBg: "#141312",
    errorSoft: "rgba(239, 83, 80, 0.14)",
    successSoft: "rgba(38, 166, 154, 0.14)",
    textPrimary: "#ece9e2",
    textSoft: "#b8b3a9",
    textMuted: "#a8a398",
    textFaint: "#7e7970",
    border: "#3a3734",
    divider: "rgba(236, 233, 226, 0.12)",
    // 暗色卡面是 #262422，通用边框 #3a3734 对比太弱，表单单独提亮到可辨认的一档。
    controlBorder: "rgba(236, 233, 226, 0.28)",
    controlBorderHover: "rgba(236, 233, 226, 0.45)",
  },
};

const CSS_VAR_MAP: Record<keyof Palette, string> = {
  accent: "--accent",
  accentHover: "--accent-hover",
  accentPressed: "--accent-pressed",
  accentDeep: "--accent-deep",
  success: "--success",
  warning: "--warning",
  error: "--error",
  bgApp: "--bg-app",
  bgSurface: "--bg-surface",
  bgControl: "--bg-control",
  bgSunken: "--bg-sunken",
  bgElevated: "--bg-elevated",
  onAccent: "--on-accent",
  bgHover: "--bg-hover",
  accentSoft: "--accent-soft",
  accentSoftStrong: "--accent-soft-strong",
  sidebarBg: "--sidebar-bg",
  errorSoft: "--error-soft",
  successSoft: "--success-soft",
  textPrimary: "--text-primary",
  textSoft: "--text-soft",
  textMuted: "--text-muted",
  textFaint: "--text-faint",
  border: "--border",
  divider: "--divider",
  controlBorder: "--control-border",
  controlBorderHover: "--control-border-hover",
};

/** 把调色板写入根元素的 CSS 变量，供 Sass 组件与样式层统一引用。 */
export function applyPalette(p: Palette): void {
  const root = document.documentElement;
  (Object.keys(CSS_VAR_MAP) as Array<keyof Palette>).forEach((key) => {
    root.style.setProperty(CSS_VAR_MAP[key], p[key]);
  });
}

/** 由调色板派生 Naive UI 主题（其 CSS-in-JS 不能直接读 CSS 变量）。 */
export function naiveOverrides(p: Palette): GlobalThemeOverrides {
  return {
    common: {
      primaryColor: p.accent,
      primaryColorHover: p.accentHover,
      primaryColorPressed: p.accentPressed,
      primaryColorSuppl: p.accentHover,
      successColor: p.success,
      successColorHover: p.success,
      successColorPressed: p.success,
      successColorSuppl: p.success,
      warningColor: p.warning,
      errorColor: p.error,
      bodyColor: p.bgApp,
      cardColor: p.bgSurface,
      modalColor: p.bgSurface,
      popoverColor: p.bgSurface,
      tableColor: p.bgSurface,
      tableHeaderColor: p.bgSunken,
      inputColor: p.bgSurface,
      inputColorDisabled: p.bgSunken,
      borderColor: p.border,
      dividerColor: p.divider,
      textColorBase: p.textPrimary,
      textColor1: p.textPrimary,
      textColor2: p.textSoft,
      textColor3: p.textFaint,
      placeholderColor: p.textFaint,
      fontSize: "14px",
      fontSizeMedium: "14px",
      // 与 _tokens.scss 的 $radius-md / $radius-sm 保持一致。
      borderRadius: "9px",
      borderRadiusSmall: "6px",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    // 输入框与下拉框的边框是完整 border 字符串，必须显式覆盖：
    // common.borderColor 在暗色下过暗，会让控件轮廓直接消失（Select 用 InternalSelection）。
    Input: {
      border: `1px solid ${p.controlBorder}`,
      borderHover: `1px solid ${p.controlBorderHover}`,
      borderFocus: `1px solid ${p.accent}`,
    },
    InternalSelection: {
      border: `1px solid ${p.controlBorder}`,
      borderHover: `1px solid ${p.controlBorderHover}`,
      borderFocus: `1px solid ${p.accent}`,
      borderActive: `1px solid ${p.accent}`,
    },
    Button: { borderRadiusMedium: "9px", fontWeight: "500" },
    DataTable: {
      thColor: p.bgSunken,
      tdColorHover: `${p.accent}0d`,
      borderColor: p.divider,
    },
  };
}
