import {
  type ChatMessage,
  COPILOT_REF_KIND_LABEL,
  type CopilotMessage,
  type CopilotReference,
  type Project,
  STORY_KIND_LABEL,
  type StoryElement,
} from "@/types";
import { documentToPlainText, EMPTY_DOCUMENT_TEXT } from "@/utils/tiptap";
import { CONTEXT_LIMIT, head, projectFacts, tail } from "./aiContext";
import { storyElementService } from "./storyElementService";
import { writingService } from "./writingService";

/** 单条引用注入的字数上限：引三四条资料也不该把上下文窗口吃光。 */
const REFERENCE_LIMIT = 1500;
/** 只带最近几轮对话：更早的问答对「接着聊」帮助有限，反而拖慢每次请求。 */
const HISTORY_ROUNDS = 6;
/** 单条历史消息的长度上限，避免模型自己上一次的长篇回答滚雪球。 */
const HISTORY_CHAR_LIMIT = 1200;
/** 当前章节正文只带结尾这一段，够模型接上语气与当前情节。 */
const CHAPTER_TEXT_LIMIT = 1500;

/** 剧情靠前的信息密度更高（场景、人物出场、目标），截断时保留开头。 */
function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（内容过长已截断）`;
}

/** 把一条设定条目摊平成可读文本，字段为空就整行省略。 */
function formatElement(element: StoryElement | null): string {
  if (!element) return "";
  const detail = element.detail ?? {};
  const lines = [
    `${STORY_KIND_LABEL[element.kind]}：${element.name}`,
    element.summary ? `简介：${element.summary}` : "",
    detail.aliases?.length ? `别名：${detail.aliases.join("、")}` : "",
    detail.timeStart || detail.timeEnd
      ? `时间：${detail.timeStart ?? "?"} ~ ${detail.timeEnd ?? "?"}`
      : "",
    detail.notes ? `备注：${detail.notes}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * 取一条引用的正文。
 * 设定读条目本身；章节读已落库的正文并转成纯文本，
 * 拿不到（已删除、读失败）时返回空串，由调用方跳过而不是让整次提问失败。
 */
async function loadReferenceText(reference: CopilotReference): Promise<string> {
  if (reference.kind === "element") {
    const element = await storyElementService.get(reference.id);
    return clip(formatElement(element), REFERENCE_LIMIT);
  }
  const content = await writingService.getContent(reference.id);
  const text = documentToPlainText(content.content);
  // documentToPlainText 对空正文返回占位文案，这种占位不要塞给模型。
  if (text === EMPTY_DOCUMENT_TEXT) return "";
  return clip(text, REFERENCE_LIMIT);
}

/** 把选中的引用拼成一段资料块；全部取不到时返回空串，调用方据此不加「已引用」小节。 */
export async function buildReferenceBlock(references: CopilotReference[]): Promise<string> {
  if (references.length === 0) return "";
  const blocks = await Promise.all(
    references.map(async (reference) => {
      const text = await loadReferenceText(reference).catch(() => "");
      if (!text)
        return `### ${COPILOT_REF_KIND_LABEL[reference.kind]}：${reference.label}\n（内容为空或已删除）`;
      return `### ${COPILOT_REF_KIND_LABEL[reference.kind]}：${reference.label}\n${text}`;
    }),
  );
  return `【作者引用的资料】\n${blocks.join("\n\n")}`;
}

export interface CopilotSystemInput {
  project: Project;
  chapterTitle: string;
  chapterSummary: string;
  /** 当前章节已有正文（含未保存改动）；讨论语气与逻辑都靠它。 */
  chapterText: string;
  /** build_project_context 产出的 Markdown 上下文。 */
  context: string;
}

/**
 * Copilot 的 system 提示：与写作辅助共用作品上下文口径，但输出纪律不同——
 * 这里允许解释与建议，因为是对话而不是直接进稿的正文。
 */
export function buildCopilotSystem(input: CopilotSystemInput): string {
  const { project } = input;
  const chapterText = input.chapterText.trim();
  return [
    `你是中文小说写作顾问，正在与作者一起打磨《${project.title}》。`,
    projectFacts(project),
    "",
    "【作品上下文】",
    head(input.context, CONTEXT_LIMIT) ||
      "（还没有设定与大纲，回答时请以作者的说法为准，不要编造设定。）",
    "",
    "【当前章节】",
    input.chapterTitle || "（尚未选章）",
    input.chapterSummary ? `本章梗概：${input.chapterSummary}` : "",
    // 只带结尾：作者问的多是「接下来怎么写」「这段对话行不行」，紧邻的内容最有用。
    chapterText ? `【本章已写正文（结尾）】\n${tail(chapterText, CHAPTER_TEXT_LIMIT)}` : "",
    "",
    "【回答纪律】",
    "1. 用简洁的中文回答，可以先给结论再给理由；不要写与问题无关的客套话。",
    "2. 涉及设定与人物时以给定上下文为准；上下文没有的信息要明确说「未设定」，不要自行编造。",
    "3. 需要给出正文时，直接给可进稿的段落，不要用 Markdown 代码块或整段引号包起来。",
    "4. 篇幅控制在 400 字以内；作者要更长的内容时会明说。",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface CopilotMessagesInput {
  system: string;
  /** 之前的对话，按时间正序；最后一条是作者刚发的问题（不含在 history 里）。 */
  history: CopilotMessage[];
  question: string;
  /** buildReferenceBlock 的结果。 */
  referenceBlock: string;
  /** 按问题检索到的片段（loadRelatedNotes 的 block），没建索引时为空串。 */
  notes?: string;
}

/** 组装一次 Copilot 请求：system + 最近若干轮历史 + 本轮问题（引用与检索资料拼在问题前面）。 */
export function buildCopilotMessages(input: CopilotMessagesInput): ChatMessage[] {
  const history = input.history
    .filter((message) => !message.failed && message.content.trim().length > 0)
    .slice(-HISTORY_ROUNDS)
    .map<ChatMessage>((message) => ({
      role: message.role,
      content:
        message.content.length <= HISTORY_CHAR_LIMIT
          ? message.content
          : `${message.content.slice(0, HISTORY_CHAR_LIMIT)}…`,
    }));

  // 作者显式引用的资料在前，检索到的片段在后：两者冲突时以作者选的为准。
  const question = [input.referenceBlock, input.notes, input.question].filter(Boolean).join("\n\n");
  return [
    { role: "system", content: input.system },
    ...history,
    { role: "user", content: question },
  ];
}
