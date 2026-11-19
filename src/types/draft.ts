/**
 * 章节正文：正文与大清单分开取，列表页只关心章节元数据与字数。
 * content 是 TipTap 文档 JSON 字符串，空串表示这一章还没写过。
 */
export interface ChapterContent {
  chapterId: string;
  content: string;
  wordCount: number;
  /** 正文版本号，正文每保存一次 +1；正文乐观锁用它，而不是 updatedAt。 */
  contentRevision: number;
  updatedAt: string;
}

/** 保存正文入参；snapshot 为 true 表示手动留一版快照。 */
export interface SaveContentInput {
  chapterId: string;
  content: string;
  wordCount: number;
  snapshot?: boolean;
  /**
   * 读到的正文版本号（`ChapterContent.contentRevision`），用于后端做乐观锁比对。
   * 不传表示「不校验」（确实需要无条件整篇覆盖的入口）。
   */
  expectedContentRevision?: number;
}

/** 版本列表项：不带正文，避免一次拉回几十份全文。 */
export interface DraftVersionBrief {
  id: string;
  chapterId: string;
  version: number;
  wordCount: number;
  createdAt: string;
}

/** 单个版本的完整内容，用于预览与恢复。 */
export interface DraftVersion extends DraftVersionBrief {
  content: string;
}
