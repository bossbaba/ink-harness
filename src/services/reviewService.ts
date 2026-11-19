import {
  type Chapter,
  type ChatMessage,
  CONSISTENCY_KIND_LABEL,
  type ConsistencyIssue,
  type ConsistencyIssueKind,
  type Project,
  REVIEW_DECISION_LABEL,
  REVIEW_LAYER_LABEL,
  REVIEW_LAYER_ORDER,
  REVIEW_SEVERITY_LABEL,
  REVIEW_SEVERITY_WEIGHT,
  type ReviewIssue,
  type ReviewLayer,
  type ReviewReport,
  type ReviewScope,
  type ReviewSeverity,
} from "@/types";
import { parseLooseJsonArray } from "@/utils/looseJson";
import { fitContext, projectFacts } from "./aiContext";

/** 本章正文送进模型的上限：审稿要看全文，但再长就得截断，否则回答质量反而下降。 */
const CHAPTER_TEXT_LIMIT = 12000;
/** 设定与大纲在审稿里只做核对依据，给太多会挤掉正文。 */
const CONTEXT_LIMIT = 4000;

/** 一致性问题的通用改法：文案固定，作者一看就知道该去改哪里。 */
const CONSISTENCY_SUGGESTION: Record<ConsistencyIssueKind, string> = {
  "duplicate-name": "合并同名条目，或给其中一个改名并在正文中统一称呼",
  "timeline-conflict": "核对两条时间线的起止，调整其中一条的时间范围",
  "invalid-time-range": "把结束时间改到开始时间之后",
  "broken-relation": "删除失效关联，或补回被删掉的目标条目",
};

/** 审稿请求的输入：本章模式带正文，全书模式只有目录与摘要。 */
export interface ReviewPromptInput {
  project: Project;
  scope: ReviewScope;
  chapterTitle: string;
  chapterSummary: string;
  /** 本章正文纯文本；全书模式传空串。 */
  chapterText: string;
  /** 作品全部章节（含幕次与摘要），全书模式据此生成目录。 */
  chapters: Chapter[];
  /** build_project_context 的 Markdown（设定库 + 大纲 + 伏笔）。 */
  context: string;
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（内容过长，已截断）`;
}

/** 全书模式的目录：幕次 + 标题 + 字数 + 摘要，让模型能判断铺陈与节奏。 */
function chaptersDigest(chapters: Chapter[]): string {
  if (chapters.length === 0) return "（还没有章节）";
  return chapters
    .map((chapter) => {
      const summary = chapter.summary.trim() || "（无摘要）";
      return `- 第${chapter.act}幕 · ${chapter.title}（${chapter.wordCount} 字）：${summary}`;
    })
    .join("\n");
}

/** 统一的输出约定：模型只回 JSON 数组，前端好解析，也便于逐条渲染。 */
const OUTPUT_SCHEMA = [
  "只输出一个 JSON 数组，不要 Markdown 代码块、不要任何解释文字。数组每一项字段如下：",
  '{"layer":"structure|consistency|language","severity":"high|medium|low",',
  '"title":"一句话说清问题","quote":"原文片段，没有就填空串",',
  '"detail":"为什么是问题","suggestion":"具体怎么改",',
  '"replacement":"可直接替换 quote 的文本，没有就填空串"}',
].join("\n");

/**
 * 组装一次审稿请求：system 放编辑身份与输出纪律，user 放范围、作品上下文与正文。
 * 三层在同一次请求里出结果，避免三次调用既慢又互相看不到对方的问题。
 */
export function buildReviewMessages(input: ReviewPromptInput): ChatMessage[] {
  const { project, scope } = input;
  const system = [
    `你是一名中文小说的资深编辑，正在审读《${project.title}》。`,
    "你的任务是挑出真问题，不要夸奖作者，也不要在报告里改写原文。",
    "",
    "【审稿三层】",
    "- structure：情节推进、场景节奏、人物动机、逻辑漏洞；",
    "- consistency：人物/地点/组织/时间线与设定库、大纲是否冲突；",
    "- language：用词、句式、重复表达、标点与口语化过度。",
    "",
    "【输出格式】",
    OUTPUT_SCHEMA,
    "",
    "【纪律】",
    "1. 一共 4~12 条，按严重程度排序；某一层没问题就不要出条目。",
    "2. quote 必须是原文里的连续片段并原样摘录（不超过 60 字）；全书模式没有正文时留空串。",
    "3. 不要写「可以增加细节」「建议丰富描写」这类空话，每条建议都要能直接动手改。",
    // replacement 是「一键替换」用的，含解释或引号会污染正文，所以宁可留空让作者手工改。
    "4. replacement 必须能原样替换 quote，只写替换后的正文，不加解释、引号或前后缀；结构性问题无法一句话替换时留空串。",
    // 本地小模型最常犯的错：字段里直接写半角双引号不做转义，整份 JSON 会在这里解析失败。
    "5. 输出必须是严格 JSON：字符串内容里需要引号时用中文引号「」或“”，绝不要直接写英文双引号。",
    "6. 只谈文本，不评价作者本人，也不讨论价值观。",
  ].join("\n");

  const scopeLine =
    scope === "chapter"
      ? `本章：${input.chapterTitle}${input.chapterSummary ? `（梗概：${input.chapterSummary}）` : ""}`
      : `全书概览：共 ${input.chapters.length} 章，只给目录与摘要，language 层不适用，不要出该层条目`;

  const overview = [
    `【作品信息】\n${projectFacts(project) || "（未填写）"}`,
    `【设定与大纲】\n${fitContext(input.context, CONTEXT_LIMIT) || "（还没有设定与大纲）"}`,
  ];

  const body =
    scope === "chapter"
      ? [
          `【本章正文】\n${clip(input.chapterText, CHAPTER_TEXT_LIMIT)}`,
          "",
          "请针对上面这段正文给出三层意见。",
        ].join("\n")
      : [`【章节目录】\n${chaptersDigest(input.chapters)}`, "", "请针对全书结构给出意见。"].join(
          "\n",
        );

  const user = [`【审读范围】${scopeLine}`, "", ...overview, "", body, "", OUTPUT_SCHEMA].join(
    "\n",
  );

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

const LAYERS: ReviewLayer[] = ["structure", "consistency", "language"];

/** 模型偶尔会写中文层级或严重级别，这里统一归一化，认不出就落默认值。 */
function pickLayer(value: unknown): ReviewLayer {
  const text = String(value ?? "").toLowerCase();
  if (LAYERS.includes(text as ReviewLayer)) return text as ReviewLayer;
  if (text.includes("结构") || text.includes("情节") || text.includes("节奏")) return "structure";
  if (text.includes("一致") || text.includes("设定") || text.includes("时间线"))
    return "consistency";
  return "language";
}

function pickSeverity(value: unknown): ReviewSeverity {
  const text = String(value ?? "").toLowerCase();
  if (text === "high" || text.includes("高") || text.includes("必")) return "high";
  if (text === "low" || text.includes("低") || text.includes("可选")) return "low";
  return "medium";
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 解析模型输出为审稿条目。
 * 解析失败返回空数组，由调用方把原文摆出来，而不是直接报「解析失败」让作者无从下手。
 * 容错（裸引号、被截断、包代码块）交给 parseLooseJsonArray，别让一个坏字符带走整份报告。
 */
export function parseReviewIssues(raw: string): ReviewIssue[] {
  const items = parseLooseJsonArray(raw);

  const issues: ReviewIssue[] = [];
  items.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const title = toText(record.title);
    const detail = toText(record.detail);
    // 没有标题也没有说明的条目没法读，直接丢；只有标题的保留，说明可以由建议补。
    if (!title && !detail) return;
    issues.push({
      id: `ai-${index + 1}`,
      layer: pickLayer(record.layer),
      severity: pickSeverity(record.severity),
      title: title || "未命名问题",
      quote: toText(record.quote).slice(0, 120),
      detail,
      suggestion: toText(record.suggestion),
      // 替换文本单独截断，避免模型偶尔吐一大段把 Diff 视图撑爆。
      replacement: toText(record.replacement).slice(0, 400),
      comment: "",
      decision: "pending",
    });
  });
  return issues;
}

/** 把后端确定性一致性检查转成同一种条目，和 AI 意见混排。 */
export function consistencyToIssues(list: ConsistencyIssue[]): ReviewIssue[] {
  return list.map((issue) => ({
    id: `consistency-${issue.id}`,
    layer: "consistency" as ReviewLayer,
    severity:
      issue.severity === "warning" ? ("medium" as ReviewSeverity) : ("low" as ReviewSeverity),
    title: `${CONSISTENCY_KIND_LABEL[issue.kind]}：${issue.title}`,
    quote: "",
    detail: issue.detail,
    suggestion: CONSISTENCY_SUGGESTION[issue.kind] ?? "",
    // 确定性检查没有原文片段，也就没有可直接替换的文本，只能照说明手工调整设定。
    replacement: "",
    comment: "",
    decision: "pending",
    elementIds: issue.elementIds,
  }));
}

/** 按「层 → 严重级别」排序，让必改项先冒头。 */
export function sortReviewIssues(issues: ReviewIssue[]): ReviewIssue[] {
  return [...issues].sort((a, b) => {
    const layerDiff = REVIEW_LAYER_ORDER.indexOf(a.layer) - REVIEW_LAYER_ORDER.indexOf(b.layer);
    if (layerDiff !== 0) return layerDiff;
    return REVIEW_SEVERITY_WEIGHT[a.severity] - REVIEW_SEVERITY_WEIGHT[b.severity];
  });
}

/** 导出 Markdown：作者可以直接贴进笔记，或发给别人一起看。 */
export function reviewToMarkdown(report: ReviewReport): string {
  const lines = [
    `# 审稿报告 · ${report.target}`,
    "",
    `- 范围：${report.scope === "chapter" ? "本章" : "全书"}`,
    `- 时间：${report.createdAt}`,
    report.model ? `- 模型：${report.model}` : "",
    `- 问题数：${report.issues.length}`,
    "",
  ].filter(Boolean);

  for (const layer of REVIEW_LAYER_ORDER) {
    const issues = report.issues.filter((issue) => issue.layer === layer);
    if (issues.length === 0) continue;
    lines.push(`## ${REVIEW_LAYER_LABEL[layer]}（${issues.length}）`, "");
    for (const issue of issues) {
      // 把审阅决定一起带上：复制到笔记后还能看出哪些改了、哪些只是记下来。
      lines.push(
        `- **[${REVIEW_SEVERITY_LABEL[issue.severity]}] ${issue.title}**（${REVIEW_DECISION_LABEL[issue.decision]}）`,
      );
      if (issue.quote) lines.push(`  > ${issue.quote}`);
      if (issue.detail) lines.push(`  ${issue.detail}`);
      if (issue.replacement) lines.push(`  替换为：${issue.replacement}`);
      else if (issue.suggestion) lines.push(`  建议：${issue.suggestion}`);
      if (issue.comment) lines.push(`  批注：${issue.comment}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
