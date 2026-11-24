import type { SaveContentInput } from "./draft";

/** 工作流的五个阶段，顺序即流水线的推进顺序。 */
export type WorkflowStage = "ideation" | "writing" | "editing" | "review" | "publish";

/**
 * 阶段状态机：
 * idle 未开始 → running 生成中 → pending 待人工审批 → approved 已通过 / rejected 被打回。
 * rejected 可在原阶段重新生成，approved 才解锁下一阶段。
 */
export type WorkflowStatus = "idle" | "running" | "pending" | "approved" | "rejected";

/** 人工审批的两种决定。 */
export type WorkflowDecision = "approved" | "rejected";

/** 单个阶段的运行状态；整体序列化后存进 app_meta。 */
export interface WorkflowStageState {
  status: WorkflowStatus;
  /** 候选产物原文：方案/初稿/润色稿是文本，审稿是 JSON，物料是 JSON。 */
  artifact: string;
  /** 本次生成/落地的错误文案，界面据此显示红色提示。 */
  error: string;
  /** 实际选中的模型显示名，方便作者知道哪一层质量。 */
  model: string;
  decision: WorkflowDecision | "";
  /** 审批时间（ISO 字符串），未审批为空串。 */
  decidedAt: string;
  /** 审批备注，打回时用来记原因。 */
  note: string;
}

/** 一份作品的完整工作流状态。 */
export interface WorkflowState {
  version: number;
  /** 写作/编辑阶段共用的目标章节；空串表示还没选。 */
  selectedChapterId: string;
  stages: Record<WorkflowStage, WorkflowStageState>;
  updatedAt: string;
}

/**
 * 审批落地入参：正文写入与阶段状态一并交给 Rust，在一个事务里提交。
 * 以前是前端先写正文再写状态，中途失败会留下半写状态。
 */
export interface ApplyWorkflowInput {
  projectId: string;
  stage: WorkflowStage;
  decision: WorkflowDecision;
  /** 前端决定完阶段后的整份状态，Rust 侧校验版本与目标阶段后才落库。 */
  workflowJson: string;
  /** 写作/编辑审批通过时的正文写入；其它阶段省略。 */
  contentWrite?: SaveContentInput;
}

export const WORKFLOW_STAGES: Array<{
  key: WorkflowStage;
  label: string;
  hint: string;
}> = [
  { key: "ideation", label: "策划", hint: "生成书名、梗概与三幕大纲，审批后写入作品" },
  { key: "writing", label: "写作", hint: "按选定章节的梗概写出初稿，审批后写入正文" },
  { key: "editing", label: "编辑", hint: "润色选定章节的正文，审批后留版本并写回" },
  { key: "review", label: "审稿", hint: "三层审稿报告，审批后确认报告（改稿仍在写作台）" },
  { key: "publish", label: "出版", hint: "生成发布物料，审批后把作品标记为已发布" },
];

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  idle: "未开始",
  running: "生成中",
  pending: "待审批",
  approved: "已通过",
  rejected: "已打回",
};

export const WORKFLOW_DECISION_LABEL: Record<WorkflowDecision, string> = {
  approved: "通过",
  rejected: "打回",
};

/** 哪些阶段会读写某章正文，供页面决定「选章」控件是否出现。 */
export const WORKFLOW_CHAPTER_STAGES: WorkflowStage[] = ["writing", "editing"];
