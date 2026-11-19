import { DEFAULT_CONTEXT_BUDGET } from "./summaryService";

/**
 * AI 请求的上下文口径：写作辅助与 Copilot 对话共用同一套截断规则，
 * 避免两个入口注入的背景长度不一致、调出来的文风忽紧忽松。
 *
 * 具体裁剪函数放在 ./contextText（纯函数、无依赖），这里只负责预算常量与再导出，
 * 否则本文件与 summaryService 会形成循环依赖。
 */

/** 没设置预算时的默认值；真实额度由 summaryService 从 app_meta 读取后传入。 */
export const CONTEXT_LIMIT = DEFAULT_CONTEXT_BUDGET;

export { fitContext, head, projectFacts, tail } from "./contextText";

/** 面板上展示「已注入多少字上下文」，让作者知道模型看到了什么。 */
export function contextCharCount(context: string, limit = CONTEXT_LIMIT): number {
  return Math.min(context.length, limit);
}
