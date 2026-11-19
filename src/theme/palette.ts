import type { GlobalThemeOverrides } from "naive-ui";

/**
 * 颜色单一真源。所有语义色只在此定义一次：
 * - 运行时注入到 CSS 自定义属性（供 Sass 组件通过 var(--*) 使用）
 * - 派生 Naive UI 的 themeOverrides（CSS-in-JS 无法读 CSS 变量）
 * 主色收敛为稳重翠绿：浅色 #0f8f52 / 深色 #3ddc91，保证正文与按钮上的对比度。
 */

export interface Palette {
  accent: string;
  accentHover: string;
  accentPressed: string;
  success: string;
  warning: string;
  error: string;
  bgApp: string;
  bgSurface: string;
  bgSunken: string;
  /** 抬升表面：悬浮卡片与浮层底色，比普通 surface 再亮一层。 */
  bgElevated: string;
  /** 主色上的前景色：深色主题主色更亮，需要深色文字才清晰。 */
  onAccent: string;
  /** 悬停底色：列表项/菜单项 hover 用，明暗主题差异很大，必须走变量。 */
  bgHover: string;
  /** 主色的低饱和衬底：图标底色、选中态背景。 */
  accentSoft: string;
  /** 错误色的低饱和衬底：错误提示块背景。 */
  errorSoft: string;
  /** 成功色的低饱和衬底：成功提示块背景。 */
  successSoft: string;
  textPrimary: string;
  textSoft: string;
  textFaint: string;
  border: string;
  divider: string;
}

export const palettes: Record<"light" | "dark", Palette> = {
  light: {
    accent: "#0f8f52",
    accentHover: "#1ea363",
    accentPressed: "#0b7342",
    success: "#00897b",
    warning: "#e8a317",
    error: "#d4342a",
    bgApp: "#f7f5f0",
    bgSurface: "#fffdf8",
    bgSunken: "#efece4",
    bgElevated: "#ffffff",
    onAccent: "#ffffff",
    bgHover: "rgba(31, 30, 29, 0.06)",
    accentSoft: "rgba(15, 143, 82, 0.10)",
    errorSoft: "rgba(212, 52, 42, 0.10)",
    successSoft: "rgba(0, 137, 123, 0.10)",
    textPrimary: "#1f1e1d",
    textSoft: "#4a4844",
    textFaint: "#8c8880",
    border: "#dedbd2",
    divider: "rgba(31, 30, 29, 0.1)",
  },
  dark: {
    accent: "#3ddc91",
    accentHover: "#5ce6a6",
    accentPressed: "#2bc67f",
    success: "#26a69a",
    warning: "#f0b429",
    error: "#ef5350",
    bgApp: "#1c1b1a",
    bgSurface: "#262422",
    bgSunken: "#141312",
    bgElevated: "#2f2c29",
    onAccent: "#0c2018",
    bgHover: "rgba(236, 233, 226, 0.08)",
    accentSoft: "rgba(61, 220, 145, 0.14)",
    errorSoft: "rgba(239, 83, 80, 0.14)",
    successSoft: "rgba(38, 166, 154, 0.14)",
    textPrimary: "#ece9e2",
    textSoft: "#b8b3a9",
    textFaint: "#7e7970",
    border: "#3a3734",
    divider: "rgba(236, 233, 226, 0.12)",
  },
};

const CSS_VAR_MAP: Record<keyof Palette, string> = {
  accent: "--accent",
  accentHover: "--accent-hover",
  accentPressed: "--accent-pressed",
  success: "--success",
  warning: "--warning",
  error: "--error",
  bgApp: "--bg-app",
  bgSurface: "--bg-surface",
  bgSunken: "--bg-sunken",
  bgElevated: "--bg-elevated",
  onAccent: "--on-accent",
  bgHover: "--bg-hover",
  accentSoft: "--accent-soft",
  errorSoft: "--error-soft",
  successSoft: "--success-soft",
  textPrimary: "--text-primary",
  textSoft: "--text-soft",
  textFaint: "--text-faint",
  border: "--border",
  divider: "--divider",
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
        '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    Button: { borderRadiusMedium: "9px", fontWeight: "500" },
    DataTable: {
      thColor: p.bgSunken,
      tdColorHover: `${p.accent}0d`,
      borderColor: p.divider,
    },
  };
}
