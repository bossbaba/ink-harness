/**
 * 弹窗尺寸约定。
 *
 * Naive UI 的 `preset="card"` 没有宽度上限：不给 width 时，弹窗会撑满可用宽度
 *（宽窗口里就是一条几乎横跨全屏的横条，输入框和按钮被拉得很散），
 * 窄窗口里又可能顶到屏幕边缘。项目里所有弹窗统一走这里给尺寸：
 *
 * - `modalStyle(宽)` 同时给固定宽度与视口兜底；
 * - `MODAL_WIDTH` 把档位收敛成四个常用值，避免每个弹窗随手写 px。
 *
 * 只写 `class` 不管用：NModal 默认 teleport 到 body，scoped 样式命中不到它。
 * `check:conventions` 会校验每个 `preset="card"` 的 NModal 是否带了尺寸。
 */

/** 弹窗宽度档位：单字段 → 简单表单 → 分组表单 → 预览/长内容。 */
export const MODAL_WIDTH = {
  sm: 420,
  md: 520,
  lg: 640,
  xl: 760,
} as const;

/** 生成 NModal 的 style：固定宽度 + 视口兜底，小窗口下也不会被裁掉。 */
export function modalStyle(width: number): Record<string, string> {
  return {
    width: `${width}px`,
    // 48px 是左右各留 24px：窄窗口弹窗仍然贴边可见，不会出现横向滚动条。
    maxWidth: "calc(100vw - 48px)",
  };
}
