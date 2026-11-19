import { runChat } from "@/services/aiChat";
import { fitContext } from "@/services/aiContext";
import { buildSummaryMessages } from "@/services/prompts/summary";

// 兼容既有调用方（组件仍从本模块引用）。
export { buildSummaryMessages, clipChapterText } from "@/services/prompts/summary";

import { settingsService } from "@/services/settingsService";
import type { Chapter, PrivacyScope, Project } from "@/types";

/** 单次注入上下文的字符预算；0/未设置时回落到默认值。 */
export const SETTING_CONTEXT_BUDGET = "context_budget";
export const DEFAULT_CONTEXT_BUDGET = 6000;

/** 章节正文比生成摘要时多出这些字，才算「摘要过期」。 */
export const SUMMARY_STALE_CHARS = 300;

/** 正文每多出这些字触发一次自动摘要（仅开启自动更新时生效）。 */
export const AUTO_SUMMARY_CHARS = 500;

/** 是否保存后自动刷新过期摘要，默认关闭，避免自动保存频繁调用模型。 */
export const SETTING_AUTO_SUMMARY = "auto_summary";

const SUMMARY_META_PREFIX = "summary_meta:";

/** 摘要生成时记下字数与时间，用来判断正文改了多少之后再提醒更新。 */
export interface SummaryMeta {
  wordCount: number;
  generatedAt: string;
  model: string;
}

function metaKey(chapterId: string): string {
  return `${SUMMARY_META_PREFIX}${chapterId}`;
}

export async function loadSummaryMeta(chapterId: string): Promise<SummaryMeta | null> {
  const raw = await settingsService.getString(metaKey(chapterId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SummaryMeta>;
    if (typeof parsed.wordCount !== "number") return null;
    return {
      wordCount: parsed.wordCount,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
    };
  } catch {
    return null;
  }
}

export async function saveSummaryMeta(chapterId: string, meta: SummaryMeta): Promise<void> {
  await settingsService.setString(metaKey(chapterId), JSON.stringify(meta));
}

/** 模型偶尔会包一层代码块或加「摘要：」，清掉再写库，免得污染注入内容。 */
export function cleanSummary(raw: string): string {
  return raw
    .replace(/^```(?:markdown|text)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .replace(/^\s*摘要\s*[:：]\s*/u, "")
    .replace(/^["「『]|["」』]$/gu, "")
    .trim()
    .slice(0, 400);
}

export interface SummaryRequest {
  project: Project;
  chapter: Chapter;
  text: string;
  privacy: PrivacyScope;
  projectId: string;
  /** 作品上下文（设定/大纲/伏笔），由调用方取好传进来。 */
  context?: string;
}

export async function requestChapterSummary(
  input: SummaryRequest,
  onChunk?: (received: number) => void,
): Promise<string> {
  const { raw, failure } = await runChat(
    { task: "summary", privacy: input.privacy, projectId: input.projectId },
    buildSummaryMessages(
      input.project,
      input.chapter,
      input.text,
      fitContext(input.context ?? "", DEFAULT_CONTEXT_BUDGET),
    ),
    onChunk,
  );
  // 真实失败原因优先抛出：网络/鉴权/配额问题不能只显示「没有给出摘要」。
  if (failure) throw new Error(failure);
  const summary = cleanSummary(raw);
  if (!summary) throw new Error("模型没有给出摘要，可以再试一次。");
  return summary;
}

export async function getContextBudget(): Promise<number> {
  const raw = await settingsService.getString(SETTING_CONTEXT_BUDGET);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CONTEXT_BUDGET;
}

export async function setContextBudget(value: number): Promise<void> {
  await settingsService.setString(SETTING_CONTEXT_BUDGET, String(Math.max(1000, value)));
}

export async function getAutoSummary(): Promise<boolean> {
  return settingsService.getBool(SETTING_AUTO_SUMMARY, false);
}

export async function setAutoSummary(value: boolean): Promise<void> {
  await settingsService.setBool(SETTING_AUTO_SUMMARY, value);
}
