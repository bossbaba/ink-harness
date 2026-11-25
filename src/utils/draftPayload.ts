import type { JSONContent } from "@tiptap/vue-3";

/**
 * 正文在编辑与落库之间的载荷。
 *
 * 编辑器每次输入都回传结构化文档，写作台只在真正备份/写库时序列化一次。
 * 长篇正文若每敲一个字就 stringify 整篇文档，输入会明显卡顿；
 * TipTap 的 `getJSON()` 返回独立快照，暂存引用不会被后续输入改写。
 */
export interface EditorPayload {
  /** TipTap 文档对象，落库前才转成字符串。 */
  doc: JSONContent;
  /** 编辑器纯文本，用来实时计算字数。 */
  text: string;
}

/** 待落库的正文：章节 id 随内容一起排队，避免切章时写错对象。 */
export interface PendingDraft {
  chapterId: string;
  doc: JSONContent;
  wordCount: number;
}

/** 把待保存文档序列化成落库/备份共用的字符串。 */
export function serializeDraft(draft: PendingDraft): string {
  return JSON.stringify(draft.doc);
}
