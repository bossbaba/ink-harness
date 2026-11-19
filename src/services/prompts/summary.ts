import type { Chapter, ChatMessage, Project } from "@/types";

/**
 * 章节摘要提示词。
 *
 * 摘要直接决定 RAG 注入的质量，措辞改动要有依据，所以从 service 单独拆出来，
 * 与「元数据读写 / 过期判定」这类业务逻辑分开维护。
 */

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
  /** 作品上下文（设定/大纲/伏笔），让摘要能写清「埋下或回收了什么伏笔」。 */
  context = "",
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
    context.trim() ? `【设定与大纲（含伏笔）】\n${context}` : "",
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
