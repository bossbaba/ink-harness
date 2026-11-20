/** 篇幅预期，影响 AI 对章节规模与节奏的建议。 */
export type NovelLength = "短篇" | "中篇" | "长篇";

/** 构思访谈的答案集合；分步填写，最终一次性交给模型。 */
export interface IdeationAnswers {
  /** 一句话灵感：最原始的想法。 */
  inspiration: string;
  genre: string;
  audience: string;
  /** 主角：是谁、想要什么。 */
  protagonist: string;
  /** 对手或阻力：谁/什么在阻止主角。 */
  antagonist: string;
  /** 核心冲突：故事的主要拉扯。 */
  conflict: string;
  world: string;
  style: string;
  length: NovelLength;
}

/** AI 返回的大纲骨架，直接对应 chapter / scene 字段。 */
export interface ProposalScene {
  title: string;
  pov: string;
  location: string;
  timeMark: string;
  summary: string;
}

export interface ProposalChapter {
  title: string;
  summary: string;
  scenes: ProposalScene[];
}

export interface ProposalAct {
  act: 1 | 2 | 3;
  chapters: ProposalChapter[];
}

/** 立项方案：书名候选 + 梗概/简介/读者画像 + 三幕骨架。 */
export interface IdeaProposal {
  titles: string[];
  premise: string;
  synopsis: string;
  audience: string;
  style: string;
  outline: ProposalAct[];
}

/**
 * 构思草稿：一个作品一份，切页/关应用后按它恢复现场。
 * `answers` / `proposal` 已由 service 解析成对象；解析失败时为 null，交给调用方忽略。
 */
export interface IdeationDraft {
  projectId: string;
  answers: IdeationAnswers | null;
  proposal: IdeaProposal | null;
  step: number;
  maxStep: number;
  selectedTitle: string;
  includeOutline: boolean;
  applied: boolean;
  outlineCreated: boolean;
  updatedAt: string;
}

/** 保存草稿的业务入参；JSON 序列化在 service 层完成。 */
export interface IdeationDraftInput {
  projectId: string;
  answers: IdeationAnswers;
  proposal: IdeaProposal | null;
  step: number;
  maxStep: number;
  selectedTitle: string;
  includeOutline: boolean;
  applied: boolean;
  outlineCreated: boolean;
}

/** IPC 原始结构：答案与方案以 JSON 字符串传输，避免后端为问卷结构建模。 */
export interface IdeationDraftRow {
  projectId: string;
  answersJson: string;
  proposalJson: string;
  step: number;
  maxStep: number;
  selectedTitle: string;
  includeOutline: boolean;
  applied: boolean;
  outlineCreated: boolean;
  updatedAt: string;
}

/** 写入草稿的 IPC 入参：时间戳由后端生成。 */
export type IdeationDraftRowInput = Omit<IdeationDraftRow, "updatedAt">;

/** 左侧步骤条的数据；最后一步同时承担生成与写入。 */
export const IDEATION_STEPS: Array<{ label: string; hint: string }> = [
  { label: "灵感", hint: "一句话说清你想写什么" },
  { label: "人物", hint: "谁在追求什么、被什么阻挡" },
  { label: "世界与基调", hint: "时代、氛围与读者" },
  { label: "方案确认", hint: "挑选书名并写入作品" },
];
