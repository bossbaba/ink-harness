import type { JSONContent } from "@tiptap/vue-3";

/** 空文档：TipTap 对空内容的标准形态，用于「从未写过」的章节。 */
export const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

/**
 * 解析库里存的正文。
 * 老库可能存的是空串或早期版本的非法 JSON，此时一律退回空文档，
 * 而不是把异常抛给编辑器导致整页白屏。
 */
export function parseDocument(raw: string): JSONContent {
  if (!raw.trim()) return EMPTY_DOC;
  try {
    const parsed = JSON.parse(raw) as JSONContent;
    return parsed?.type === "doc" ? parsed : EMPTY_DOC;
  } catch {
    return EMPTY_DOC;
  }
}

/**
 * 提取纯文本，用于版本预览这类只需要「看清写了什么」的地方，
 * 不引入完整的 HTML 渲染链路。
 */
export function documentToPlainText(raw: string): string {
  const doc = parseDocument(raw);
  const lines: string[] = [];

  const walk = (node: JSONContent): void => {
    if (node.type === "text" && node.text) {
      lines.push(node.text);
      return;
    }
    // 段落/标题/列表项之间换行，避免预览里所有文字黏成一行。
    const isBlock =
      node.type === "paragraph" || node.type === "heading" || node.type === "listItem";
    if (isBlock && lines.length > 0) lines.push("\n");
    for (const child of node.content ?? []) walk(child);
    if (isBlock) lines.push("\n");
  };

  walk(doc);
  const text = lines
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || "（空白正文）";
}
