/**
 * 幕次：从 1 开始的正整数。
 * 传统三幕（建置/对抗/结局）只是默认骨架，作者可以继续新增第四幕、第五幕。
 */
export type Act = number;

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
  /** 大纲元数据版本：改标题/幕次/状态时递增，正文自动保存不碰它。 */
  metaRevision: number;
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

/** 默认三幕；新增的幕在此基础上往后排。 */
export const DEFAULT_ACT_COUNT = 3;

/** 幕次上限：只是防止误输入过大的数字，正常写作远用不到。 */
export const MAX_ACTS = 99;

/** 前三幕的传统含义；新增的幕没有固定语义，由作者自行安排。 */
export const ACT_HINTS: Record<number, string> = {
  1: "建置 · 介绍人物与世界",
  2: "对抗 · 冲突升级",
  3: "结局 · 收束与回扣",
};

/** 1~99 转成中文数字，保证「第四幕」「第十一幕」这类标签读起来自然。 */
function chineseNumber(value: number): string {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 0) return String(value);
  if (value < 10) return digits[value];
  if (value < 20) return `十${value % 10 === 0 ? "" : digits[value % 10]}`;
  if (value < 100) {
    return `${digits[Math.floor(value / 10)]}十${value % 10 === 0 ? "" : digits[value % 10]}`;
  }
  return String(value);
}

/** 统一幕次文案，避免各处一边写「第4幕」一边写「第四幕」。 */
export function actLabel(act: Act): string {
  return `第${chineseNumber(act)}幕`;
}

/** 章节弹窗/看板用的幕次选项。 */
export function actOptions(count: number): Array<{ label: string; value: Act }> {
  return Array.from({ length: Math.max(1, count) }, (_, index) => ({
    label: actLabel(index + 1),
    value: index + 1,
  }));
}

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
