import type { AssistSelection, AssistTask, ChatMessage, Project, TaskKind } from "@/types";

/** 超过这个字数的作品上下文会被截断，宁可少给背景也别把模型上下文窗口撑爆。 */
const CONTEXT_LIMIT = 6000;
/** 选区之前只带最近这一段：更早的内容对「接得上语气」帮助有限，反而占额度。 */
const BEFORE_LIMIT = 1200;

/** 五个动作各自的写作要求，统一强调「只输出正文」，避免模型解释性文字被插进稿子。 */
const TASK_RULE: Record<AssistTask, string> = {
  continue: "接着前文往下写 200~400 字，不要重复前文最后一句，只输出新写出来的正文。",
  rewrite:
    "在不改变情节事实与人物关系的前提下重写选中段落，让动作、对白与画面更具体，只输出改写后的段落。",
  expand:
    "把选中段落扩写到原来的 2~3 倍，补充动作、感官与心理细节，不新增关键情节与人物，只输出扩写后的段落。",
  condense: "把选中段落压缩到原来的一半以内，保留关键动作、信息与情绪转折，只输出压缩后的段落。",
  polish:
    "只做语言层面的润色：去掉重复与口水话、理顺语序、替换生硬表达，保持原意与大致篇幅，只输出润色后的段落。",
};

/** 动作 → 路由用的任务类型，据此决定模型偏好（见 modelRouter 的任务偏好表）。 */
const TASK_KIND: Record<AssistTask, TaskKind> = {
  continue: "continue",
  rewrite: "rewrite",
  expand: "expand",
  condense: "condense",
  polish: "polish",
};

export function toTaskKind(task: AssistTask): TaskKind {
  return TASK_KIND[task];
}

/** 作品上下文保留开头（作品信息、设定库、大纲都在前面）。 */
function head(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（上下文过长，已截断）`;
}

/** 前文保留结尾，续写靠的正是紧邻选区的那几句。 */
function tail(text: string, limit: number): string {
  return text.length <= limit ? text : `…（前文过长，只保留结尾）\n${text.slice(-limit)}`;
}

export interface AssistMessageInput {
  project: Project;
  chapterTitle: string;
  chapterSummary: string;
  /** build_project_context 产出的 Markdown 上下文。 */
  context: string;
  selection: AssistSelection;
}

/**
 * 组装一次写作辅助请求：system 放作品背景与输出纪律，user 放前文、选中段落与具体任务。
 * 拆成两条消息而不是全塞一条，便于后续接入对话式 Copilot 时复用同一段 system。
 */
export function buildAssistMessages(input: AssistMessageInput): ChatMessage[] {
  const { project, chapterTitle, chapterSummary, selection } = input;
  const facts = [
    project.genre ? `类型：${project.genre}` : "",
    project.premise ? `一句话梗概：${project.premise}` : "",
    project.style ? `叙事风格：${project.style}` : "",
    project.audience ? `目标读者：${project.audience}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    `你是中文小说写作助手，正在协助作者写《${project.title}》。`,
    facts,
    "",
    "【作品上下文】",
    head(input.context, CONTEXT_LIMIT) || "（还没有设定与大纲，请贴合作者正文的风格自由发挥。）",
    "",
    "【当前章节】",
    chapterTitle,
    chapterSummary ? `本章梗概：${chapterSummary}` : "",
    "",
    "【输出纪律】",
    "1. 只输出可以直接粘进稿子的正文，不要解释、不要 Markdown 标记、不要用引号把整段包起来。",
    "2. 沿用原文的人称、时态、语气与人物称呼，不要擅自改名、改设定或新增重要人物。",
    "3. 不要复述已给出的前文，不要写「以下是续写」这类开场白。",
  ].join("\n");

  const user = [
    `任务：${TASK_RULE[selection.task]}`,
    selection.before ? `【前文结尾】\n${tail(selection.before, BEFORE_LIMIT)}` : "",
    selection.text ? `【选中段落】\n${selection.text}` : "【选中段落】（未选中，请紧接前文往下写）",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** 面板上展示「已注入多少字上下文」，让作者知道模型看到了什么。 */
export function contextCharCount(context: string): number {
  return Math.min(context.length, CONTEXT_LIMIT);
}
