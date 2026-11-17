/** 写作台可用的 AI 动作。 */
export type AssistTask = "continue" | "rewrite" | "expand" | "condense" | "polish";

/** 编辑器交给 AI 的选区信息：位置用于回写正文，text 为空表示「续写」而非改写。 */
export interface AssistSelection {
  task: AssistTask;
  /** 选中的正文；续写时为空串。 */
  text: string;
  /** 选区之前的一段正文，让模型接得上语气与语境。 */
  before: string;
  /** TipTap 文档中的选区起止位置。 */
  from: number;
  to: number;
}

/** AI 结果的回写方式：insert 插到选区末尾（续写常用），replace 覆盖选中文本。 */
export type AssistApplyMode = "insert" | "replace";

/** 面板标题与按钮统一用这套文案，避免各页面各写一份。 */
export const ASSIST_TASK_LABEL: Record<AssistTask, string> = {
  continue: "续写",
  rewrite: "改写",
  expand: "扩写",
  condense: "缩写",
  polish: "润色",
};

/**
 * 右侧 AI 面板里「辅助任务卡片」的展示状态。
 *
 * 由 useWritingAssist 组装成一个对象，页面只负责原样透传给面板，
 * 避免页面与卡片两边各拼一次字段、各写一套按钮可用条件。
 */
export interface AssistCardState {
  /** 是否有正在展示的辅助结果；未开始、或已被下一次动作/换章覆盖时为 false。 */
  visible: boolean;
  taskLabel: string;
  output: string;
  streaming: boolean;
  error: string;
  /** 本次注入的作品上下文字数。 */
  contextChars: number;
  /** 本次额外检索到的片段数。 */
  retrievedCount: number;
  /** 结果是否已可供回写。 */
  canApply: boolean;
  /** 是否有选中段落可被替换（续写时为 false）。 */
  canReplace: boolean;
}
