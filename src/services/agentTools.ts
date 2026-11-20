import { runChat } from "@/services/aiChat";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import { ragService } from "@/services/ragService";
import { applyReviewEdits, type ReviewEdit } from "@/services/reviewApply";
import { buildReviewMessages, parseReviewIssues } from "@/services/reviewService";
import { storyElementService } from "@/services/storyElementService";
import { writingService } from "@/services/writingService";
import type { AgentTool, ToolContext } from "@/types";
import { REVIEW_LAYER_LABEL, REVIEW_SEVERITY_LABEL, type ReviewIssue } from "@/types/review";

/**
 * Agent 工具注册表：把现有 service 包装成模型可调用的工具。
 *
 * 工具只在这里注册，执行器按 name 查找；新增工具时只需在 TOOLS 里加一项，
 * 不需要改动执行器或 Agent Loop。read 工具自动执行，write 工具只产出「待审批」，
 * 真正的落库动作由作者确认后执行，保持项目「人在环路」的产品约束。
 */

/** 把对象序列化成给模型看的紧凑文本，避免把 JSON 大括号直接丢进提示词。 */
function text(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/** 按 id 取设定，找不到时返回可读提示而不是抛异常，让模型能继续决策。 */
async function findElement(id: unknown): Promise<string> {
  const elementId = typeof id === "string" ? id : "";
  if (!elementId) return "未提供设定 id";
  const element = await storyElementService.get(elementId);
  return element ? text(element) : `设定 ${elementId} 不存在`;
}

const getProject: AgentTool = {
  name: "get_project",
  description: "读取当前作品的基本信息（书名、类型、一句话梗概、目标读者、风格）。",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  risk: "read",
  async run(_args, ctx: ToolContext) {
    const project = await projectService.get(ctx.projectId);
    return project ? text(project) : "当前作品不存在";
  },
};

const listElements: AgentTool = {
  name: "list_elements",
  description: "列出当前作品的设定条目（人物/地点/组织/术语/事件）。可按 kind 过滤。",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        description: "可选过滤：character | place | org | term | event",
        enum: ["character", "place", "org", "term", "event"],
      },
    },
    additionalProperties: false,
  },
  risk: "read",
  async run(args, ctx) {
    const all = await storyElementService.list(ctx.projectId);
    const kind = typeof args.kind === "string" ? args.kind : "";
    const list = kind ? all.filter((item) => item.kind === kind) : all;
    return list.length ? text(list) : "当前没有符合的设定条目";
  },
};

const readChapter: AgentTool = {
  name: "read_chapter",
  description: "读取一章的目录信息或正文。不带 chapterId 时读当前选中的章节。",
  parameters: {
    type: "object",
    properties: {
      chapterId: { type: "string", description: "章节 id；省略表示当前章节" },
      withContent: { type: "boolean", description: "是否带正文；默认只给目录信息" },
    },
    additionalProperties: false,
  },
  risk: "read",
  async run(args, ctx) {
    const chapterId =
      typeof args.chapterId === "string" && args.chapterId ? args.chapterId : ctx.chapterId;
    if (!chapterId) return "尚未选择章节，且未提供 chapterId";
    const snapshot = await outlineService.snapshot(ctx.projectId);
    const chapter = snapshot.chapters.find((item) => item.id === chapterId);
    if (!chapter) return `章节 ${chapterId} 不存在`;
    if (args.withContent !== true) return text(chapter);
    const content = await writingService.getContent(chapterId);
    return text({ chapter, content });
  },
};

const searchNotes: AgentTool = {
  name: "search_notes",
  description: "在作品的设定与正文里做语义检索，找出与问题相关的片段。",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "要检索的问题或关键词" },
      limit: { type: "number", description: "最多返回几条，默认 4" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  risk: "read",
  async run(args, ctx) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return "检索内容为空";
    const limit = typeof args.limit === "number" ? Math.max(1, Math.min(20, args.limit)) : 4;
    const notes = await ragService.search(ctx.projectId, query, limit);
    return notes.length ? text(notes) : "没有检索到相关片段";
  },
};

/**
 * 写工具：生成一段「可插入正文的候选文本」，不直接落库。
 * risk=write 让执行器把它挂起等作者审批，审批通过后由 UI 决定插入位置。
 */
const proposeText: AgentTool = {
  name: "propose_text",
  description:
    "产出一段候选正文或改写建议，提交作者审批。不会自动写入作品；作者通过后由界面插入正文。",
  parameters: {
    type: "object",
    properties: {
      label: { type: "string", description: "一句话说明这段文本的用途" },
      content: { type: "string", description: "候选文本正文" },
    },
    required: ["content"],
    additionalProperties: false,
  },
  risk: "write",
  async run(args) {
    // 写工具的 run 只负责把校验后的内容回传给审批界面；真正的插入由 UI 用 content 完成。
    const content = typeof args.content === "string" ? args.content : "";
    const label = typeof args.label === "string" && args.label ? args.label : "候选文本";
    return text({ label, content });
  },
};

/** 单次应用修改的条数上限：一次改几十处既超上下文，也让作者无从逐条核对。 */
const MAX_EDITS = 50;

/**
 * 把「原文 → 替换」的修改真正写到章节正文里，是当前唯一的落库型写工具。
 *
 * 复用 reviewApply.applyReviewEdits：只在单个段落内按 quote 定位，
 * 找不到就跳过（不猜位置），返回哪些成功、哪些失败，由作者回写作台手工补。
 * 保存带 expectedContentRevision 乐观锁——审批期间正文被别的页面改过就失败，
 * 不会把作者刚写的内容盖掉；snapshot=true 让本次修改在版本历史里留得下痕。
 */
const applyEdits: AgentTool = {
  name: "apply_edits",
  description:
    "把若干处「原文→替换」修改应用到章节正文，提交作者审批。审批通过后才写入正文并留版本快照；找不到原文的条目会跳过。",
  parameters: {
    type: "object",
    properties: {
      chapterId: { type: "string", description: "章节 id；省略表示当前章节" },
      label: { type: "string", description: "一句话说明这批修改的用途" },
      edits: {
        type: "array",
        description: `修改条目，最多 ${MAX_EDITS} 条；quote 必须是正文里的原文片段`,
        items: {
          type: "object",
          properties: {
            quote: { type: "string", description: "要替换的原文片段" },
            replacement: { type: "string", description: "替换后的文字" },
          },
          required: ["quote", "replacement"],
        },
      },
    },
    required: ["edits"],
    additionalProperties: false,
  },
  risk: "write",
  async run(args, ctx) {
    const chapterId =
      typeof args.chapterId === "string" && args.chapterId ? args.chapterId : ctx.chapterId;
    if (!chapterId) return "尚未选择章节，且未提供 chapterId";
    const raw = Array.isArray(args.edits) ? args.edits : [];
    const edits: ReviewEdit[] = [];
    for (const [index, item] of raw.entries()) {
      if (!item || typeof item !== "object") continue;
      const { quote, replacement } = item as { quote?: unknown; replacement?: unknown };
      if (typeof quote !== "string" || !quote.trim()) continue;
      if (typeof replacement !== "string") continue;
      edits.push({ id: `edit-${index}`, quote, replacement });
    }
    if (edits.length === 0) return "没有可应用的修改（edits 为空或格式不对）";
    if (edits.length > MAX_EDITS) return `一次最多应用 ${MAX_EDITS} 处修改，请拆成多批`;

    const current = await writingService.getContent(chapterId);
    const result = applyReviewEdits(current.content, edits);
    if (result.appliedIds.length === 0) {
      return `没有在正文里找到要替换的原文，未做任何改动（${result.failedIds.length} 条定位失败）`;
    }
    await writingService.saveContent({
      chapterId,
      content: result.content,
      wordCount: result.wordCount,
      // 留一版快照，作者在版本历史里能回到这次修改之后的状态再手工调整。
      snapshot: true,
      // 乐观锁：审批期间正文若被改动，这里会抛冲突，执行器把它标成失败。
      expectedContentRevision: current.contentRevision,
    });
    return `已应用 ${result.appliedIds.length} 处修改${
      result.failedIds.length ? `，${result.failedIds.length} 处未匹配原文已跳过` : ""
    }`;
  },
};

/** 用 id 引用一条设定，属于写操作的准备动作：返回设定内容，是否修改仍由作者决定。 */
const inspectElement: AgentTool = {
  name: "inspect_element",
  description: "按 id 查看一条设定的完整字段，常用于修改前的核对。",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "设定条目 id" } },
    required: ["id"],
    additionalProperties: false,
  },
  risk: "read",
  async run(args) {
    return findElement(args.id);
  },
};

/** 把审稿条目压成模型易读的清单；层级与级别标签复用审稿页的中文映射，避免两套叫法。 */
function formatIssues(issues: ReviewIssue[]): string {
  return issues
    .map((issue, index) => {
      const head = `${index + 1}. [${REVIEW_SEVERITY_LABEL[issue.severity]}·${REVIEW_LAYER_LABEL[issue.layer]}] ${issue.title}`;
      const parts = [
        issue.quote ? `原文：「${issue.quote}」` : "",
        issue.detail,
        issue.suggestion ? `建议：${issue.suggestion}` : "",
      ].filter(Boolean);
      return parts.length ? `${head}\n${parts.join("\n")}` : head;
    })
    .join("\n");
}

/**
 * 生成审稿建议：跑一次完整的审稿请求并把条目回填给模型。
 * risk=read——审稿只产出建议、不改作品，作者要动手时再由模型用 propose_text 走审批。
 * 隐私范围直接读作品配置，漏传参数也不会把本地作品发去云端模型。
 */
const proposeReview: AgentTool = {
  name: "propose_review",
  description:
    "调用审稿模型审读当前章节（或指定 chapterId 的章节），返回按严重程度排序的结构化修改建议。只读不改，耗时较长，慎用于多章连审。",
  parameters: {
    type: "object",
    properties: {
      chapterId: { type: "string", description: "章节 id；省略表示当前章节" },
    },
    additionalProperties: false,
  },
  risk: "read",
  async run(args, ctx) {
    const chapterId =
      typeof args.chapterId === "string" && args.chapterId ? args.chapterId : ctx.chapterId;
    if (!chapterId) return "尚未选择章节，且未提供 chapterId";
    const project = await projectService.get(ctx.projectId);
    if (!project) return "当前作品不存在";
    const snapshot = await outlineService.snapshot(ctx.projectId);
    const chapter = snapshot.chapters.find((item) => item.id === chapterId);
    if (!chapter) return `章节 ${chapterId} 不存在`;
    const [body, context] = await Promise.all([
      writingService.getContent(chapterId),
      outlineService.buildContext(ctx.projectId),
    ]);
    const content = body.content;
    if (!content.trim()) return "这一章还没有正文，先写一点再来审。";

    const result = await runChat(
      { task: "review", privacy: project.privacy, projectId: ctx.projectId },
      buildReviewMessages({
        project,
        scope: "chapter",
        chapterTitle: chapter.title,
        chapterSummary: chapter.summary,
        chapterText: content,
        chapters: snapshot.chapters,
        context,
      }),
    );
    if (result.failure) return `审稿调用失败：${result.failure}`;
    if (!result.raw.trim()) return "审稿模型没有返回内容";
    const issues = parseReviewIssues(result.raw);
    // 解析不出条目时回传原文：模型说的话作者至少能看到，而不是一个空清单。
    if (!issues.length) return `模型输出未能解析成条目，原文如下：\n${result.raw}`;
    return `共 ${issues.length} 条建议：\n${formatIssues(issues)}`;
  },
};

/** 注册表：顺序即工具列表顺序，模型看到的描述也按这个顺序。 */
export const AGENT_TOOLS: AgentTool[] = [
  getProject,
  listElements,
  readChapter,
  searchNotes,
  inspectElement,
  proposeReview,
  proposeText,
  applyEdits,
];

/** 按名字找工具；未注册的名字返回 undefined，由执行器转成错误观察。 */
export function findTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}

/** 把注册表转成发给模型的 OpenAI function 定义。 */
export function toToolDefinitions(): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return AGENT_TOOLS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
