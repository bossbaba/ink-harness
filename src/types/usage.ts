/** 按任务聚合的用量。 */
export interface TaskUsage {
  taskKind: string;
  calls: number;
  tokens: number;
}

/** 按模型聚合的用量；模型标识形如 `providerId:modelId`。 */
export interface ModelUsage {
  model: string;
  calls: number;
  tokens: number;
}

/** 成本看板需要的总量与两个拆分维度。 */
export interface UsageStats {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  byTask: TaskUsage[];
  byModel: ModelUsage[];
}

/** 任务的技术标识换成界面看得懂的名字；未登记的任务原样显示。 */
export const TASK_KIND_LABEL: Record<string, string> = {
  ideation: "构思向导",
  copilot: "Copilot",
  continue: "续写",
  rewrite: "改写",
  expand: "扩写",
  condense: "缩写",
  polish: "润色",
  review: "审稿",
  summary: "摘要",
  publish: "发布物料",
};
