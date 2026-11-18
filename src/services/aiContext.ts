import type { Project } from "@/types";
import { DEFAULT_CONTEXT_BUDGET } from "./summaryService";

/**
 * AI 请求的上下文口径：写作辅助与 Copilot 对话共用同一套截断规则，
 * 避免两个入口注入的背景长度不一致、调出来的文风忽紧忽松。
 */

/** 没设置预算时的默认值；真实额度由 summaryService 从 app_meta 读取后传入。 */
export const CONTEXT_LIMIT = DEFAULT_CONTEXT_BUDGET;

/** 作品上下文保留开头（作品信息、设定库、大纲都在前面）。 */
export function head(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（上下文过长，已截断）`;
}

/** 前文保留结尾，续写靠的正是紧邻选区的那几句。 */
export function tail(text: string, limit: number): string {
  return text.length <= limit ? text : `…（前文过长，只保留结尾）\n${text.slice(-limit)}`;
}

/** 面板上展示「已注入多少字上下文」，让作者知道模型看到了什么。 */
export function contextCharCount(context: string, limit = CONTEXT_LIMIT): number {
  return Math.min(context.length, limit);
}

/** 作品的四项基本事实；空字段直接跳过，不要给模型一堆「类型：」的空行。 */
export function projectFacts(project: Project): string {
  return [
    project.genre ? `类型：${project.genre}` : "",
    project.premise ? `一句话梗概：${project.premise}` : "",
    project.style ? `叙事风格：${project.style}` : "",
    project.audience ? `目标读者：${project.audience}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
