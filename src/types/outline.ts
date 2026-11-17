/** 幕次：1 建置、2 对抗、3 结局。 */
export type Act = 1 | 2 | 3;

/** 章节状态机：待写 → 写作中 → 完成。 */
export type ChapterStatus = "planned" | "drafting" | "done";

/** 伏笔状态机：待铺设 → 已铺设 → 已回收。 */
export type ForeshadowStatus = "planned" | "setup" | "paid-off";

export interface Chapter {
  id: string;
  projectId: string;
  act: Act;
  title: string;
  summary: string;
  status: ChapterStatus;
  /** 正文非空白字符数；后端只回计数，不回正文。 */
  wordCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Scene {
  id: string;
  chapterId: string;
  title: string;
  pov: string;
  location: string;
  timeMark: string;
  summary: string;
  sortOrder: number;
}

export interface Foreshadow {
  id: string;
  projectId: string;
  title: string;
  /** 铺设章节；后端用 null 表示未指定。 */
  setupChapterId: string | null;
  /** 回收章节；后端用 null 表示未指定。 */
  payoffChapterId: string | null;
  status: ForeshadowStatus;
}

/** 大纲看板一次拉取的全量数据。 */
export interface OutlineSnapshot {
  chapters: Chapter[];
  scenes: Scene[];
  foreshadows: Foreshadow[];
}

export interface NewChapter {
  projectId: string;
  act: Act;
  title: string;
  summary?: string;
  status?: ChapterStatus;
}

export interface NewScene {
  chapterId: string;
  title: string;
  pov?: string;
  location?: string;
  timeMark?: string;
  summary?: string;
}

export interface NewForeshadow {
  projectId: string;
  title: string;
  setupChapterId?: string | null;
  payoffChapterId?: string | null;
  status?: ForeshadowStatus;
}

export interface MoveChapterInput {
  projectId: string;
  chapterId: string;
  targetAct: Act;
  targetIndex: number;
}

export interface MoveSceneInput {
  sceneId: string;
  targetChapterId: string;
  targetIndex: number;
}

/** 章节编辑弹窗的草稿（摊平字段，提交时再组装回 Chapter）。 */
export interface ChapterDraft {
  id: string;
  act: Act;
  title: string;
  summary: string;
  status: ChapterStatus;
}

/** 场景编辑弹窗的草稿。 */
export interface SceneDraft {
  id: string;
  chapterId: string;
  title: string;
  pov: string;
  location: string;
  timeMark: string;
  summary: string;
}

/** 伏笔新建草稿；空字符串代表未指定章节。 */
export interface ForeshadowDraft {
  title: string;
  setupChapterId: string;
  payoffChapterId: string;
  status: ForeshadowStatus;
}

export const OUTLINE_ACTS: Array<{ value: Act; label: string; hint: string }> = [
  { value: 1, label: "第一幕", hint: "建置 · 介绍人物与世界" },
  { value: 2, label: "第二幕", hint: "对抗 · 冲突升级" },
  { value: 3, label: "第三幕", hint: "结局 · 收束与回扣" },
];

export const CHAPTER_STATUS_OPTIONS: Array<{ label: string; value: ChapterStatus }> = [
  { label: "待写", value: "planned" },
  { label: "写作中", value: "drafting" },
  { label: "已完成", value: "done" },
];

export const CHAPTER_STATUS_LABEL: Record<ChapterStatus, string> = {
  planned: "待写",
  drafting: "写作中",
  done: "已完成",
};

export const CHAPTER_STATUS_TAG_TYPE: Record<ChapterStatus, "default" | "info" | "success"> = {
  planned: "default",
  drafting: "info",
  done: "success",
};

export const FORESHADOW_STATUS_OPTIONS: Array<{ label: string; value: ForeshadowStatus }> = [
  { label: "待铺设", value: "planned" },
  { label: "已铺设", value: "setup" },
  { label: "已回收", value: "paid-off" },
];

export const FORESHADOW_STATUS_LABEL: Record<ForeshadowStatus, string> = {
  planned: "待铺设",
  setup: "已铺设",
  "paid-off": "已回收",
};

export const FORESHADOW_STATUS_TAG_TYPE: Record<ForeshadowStatus, "default" | "info" | "success"> =
  {
    planned: "default",
    setup: "info",
    "paid-off": "success",
  };
