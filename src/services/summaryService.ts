import { modelRouter } from "@/services/modelRouter";
import { settingsService } from "@/services/settingsService";
import type { Chapter, ChatMessage, PrivacyScope, Project } from "@/types";

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

/** 摘要只看主干：超长正文取开头与结尾各一半，中段删掉也不影响「发生过什么」。 */
export function clipChapterText(text: string, limit = 4000): string {
  if (text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  return `${text.slice(0, half)}\n…（中段省略）\n${text.slice(-half)}`;
}

export function buildSummaryMessages(
  project: Project,
  chapter: Chapter,
  text: string,
): ChatMessage[] {
  const system = [
    "你是中文小说的资深编辑，正在为长篇写作维护「章节记忆」。",
    "把这一章压缩成一段能被后续 AI 写作直接引用的摘要。",
    "只输出摘要正文，不要标题、引号、Markdown 或解释，控制在 120 字以内。",
    "必须写清：发生了什么关键事件、人物关系或状态的变化、埋下或回收了什么伏笔。",
    "不要评价写得好不好，不要复述原文句子。",
  ].join("\n");
  const user = [
    `【作品】${project.title}`,
    project.premise ? `【梗概】${project.premise}` : "",
    `【章节】第${chapter.act}幕 · ${chapter.title}`,
    `【正文】\n${clipChapterText(text)}`,
    "",
    "请输出这一段摘要。",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
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
}

export async function requestChapterSummary(
  input: SummaryRequest,
  onChunk?: (received: number) => void,
): Promise<string> {
  await modelRouter.refresh();
  const model = modelRouter.select({
    task: "summary",
    privacy: input.privacy,
    projectId: input.projectId,
  });
  if (!model) throw new Error("没有可用模型，请先在模型管理里配置并启用 Provider。");

  let raw = "";
  const handle = modelRouter.chat(
    { task: "summary", privacy: input.privacy, projectId: input.projectId },
    buildSummaryMessages(input.project, input.chapter, input.text),
    (chunk) => {
      if (!chunk.delta) return;
      raw += chunk.delta;
      onChunk?.(raw.length);
    },
  );
  await handle.done.catch(() => undefined);
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
