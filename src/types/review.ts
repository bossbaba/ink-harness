/**
 * 审稿报告的领域类型。
 *
 * 三层分工固定：结构（情节、节奏、动机）、一致性（设定事实与时间线）、语言（字句与表达）。
 * 一致性有一部分来自后端确定性检查（不花钱、可复现），其余两层由模型给出。
 */

/** 审稿层：结构 / 一致性 / 语言。 */
export type ReviewLayer = "structure" | "consistency" | "language";

/** 严重级别：会影响阅读的排前面，纯建议放后面。 */
export type ReviewSeverity = "high" | "medium" | "low";

/** 审稿范围：单章（有正文，能评语言）/ 全书（只有目录与摘要，只评结构、一致性）。 */
export type ReviewScope = "chapter" | "book";

/** 一条审稿意见。 */
export interface ReviewIssue {
  id: string;
  layer: ReviewLayer;
  severity: ReviewSeverity;
  title: string;
  /** 原文片段，用于定位问题；全书模式或纯建议可能为空。 */
  quote: string;
  /** 问题说明：为什么是问题。 */
  detail: string;
  /** 修改建议；确定性检查项可能为空。 */
  suggestion: string;
  /** 确定性一致性检查带出的关联设定 id，便于跳转核对。 */
  elementIds?: string[];
}

/** 一次审稿的完整报告；不落库，关页面即丢，可复制 Markdown 留存。 */
export interface ReviewReport {
  scope: ReviewScope;
  /** 本次审的是什么：章节标题，或「全书（N 章）」。 */
  target: string;
  issues: ReviewIssue[];
  /** 本次实际使用的模型标识（`providerId:modelId`），没选到模型时为空。 */
  model: string;
  /** 模型输出解析失败时保留原文，避免「报告空白 + 一句报错」的死胡同。 */
  raw: string;
  createdAt: string;
}

export const REVIEW_LAYER_LABEL: Record<ReviewLayer, string> = {
  structure: "结构",
  consistency: "一致性",
  language: "语言",
};

/** 每层的一句话说明，放在分区标题下，让作者知道这一层在挑什么毛病。 */
export const REVIEW_LAYER_HINT: Record<ReviewLayer, string> = {
  structure: "情节推进、场景节奏、动机与逻辑是否站得住",
  consistency: "人物、地点、时间线是否与设定库和大纲冲突",
  language: "用词、句式、重复表达与标点",
};

export const REVIEW_LAYER_ORDER: ReviewLayer[] = ["structure", "consistency", "language"];

export const REVIEW_SEVERITY_LABEL: Record<ReviewSeverity, string> = {
  high: "必改",
  medium: "建议改",
  low: "可选",
};

/** 与项目既有配色约定一致：必改用 error、建议改用 warning、可选用 info。 */
export const REVIEW_SEVERITY_TAG_TYPE: Record<ReviewSeverity, "error" | "warning" | "info"> = {
  high: "error",
  medium: "warning",
  low: "info",
};

/** 严重级别的排序权重，越小越靠前。 */
export const REVIEW_SEVERITY_WEIGHT: Record<ReviewSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
