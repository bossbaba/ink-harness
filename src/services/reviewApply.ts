import type { JSONContent } from "@tiptap/vue-3";
import { countCharacters } from "@/utils/text";
import { parseDocument } from "@/utils/tiptap";

/** 一条待应用的修改：用 quote 在正文里定位，命中后换成 replacement。 */
export interface ReviewEdit {
  id: string;
  quote: string;
  replacement: string;
}

export interface ApplyEditsResult {
  /** 替换后的 TipTap 文档 JSON 字符串，可直接交给 writingService 保存。 */
  content: string;
  appliedIds: string[];
  /** 没在正文里找到 quote 的条目：不猜位置，留给作者手工改。 */
  failedIds: string[];
  wordCount: number;
}

/**
 * 找出所有「直接含 text 子节点」的容器（通常是段落或标题）。
 * 替换只在单个容器内做：审稿送模型的是按段落换行的纯文本，
 * 跨段落的引用带换行，不该在 JSON 里被误当成同一句。
 */
function textContainers(node: JSONContent, out: JSONContent[]): void {
  const children = node.content ?? [];
  if (children.some((child) => child.type === "text")) out.push(node);
  for (const child of children) textContainers(child, out);
}

/** 在一个段落内替换 quote；同一段出现多次时只改第一处，避免误伤重复用词。 */
function replaceInContainer(container: JSONContent, quote: string, replacement: string): boolean {
  const children = container.content ?? [];
  const texts = children.filter(
    (node): node is JSONContent => node.type === "text" && typeof node.text === "string",
  );
  if (texts.length === 0) return false;

  for (const node of texts) {
    const text = node.text ?? "";
    const at = text.indexOf(quote);
    if (at < 0) continue;
    node.text = text.slice(0, at) + replacement + text.slice(at + quote.length);
    return true;
  }

  // quote 跨同一段落里的多个文本节点（加粗把句子切开了）：拼接后定位。
  // 合并到首个节点会让这几个节点各自的局部样式归到一处，但比「定位失败、一条都不改」更可用；
  // 混排特别复杂的段落仍可由作者回写作台手工调整。
  const full = texts.map((node) => node.text ?? "").join("");
  const at = full.indexOf(quote);
  if (at < 0) return false;
  texts[0].text = full.slice(0, at) + replacement + full.slice(at + quote.length);
  for (const node of texts.slice(1)) {
    const index = children.indexOf(node);
    if (index >= 0) children.splice(index, 1);
  }
  return true;
}

/** 汇总全部文本节点的字符，用与编辑器一致的口径（去空白）算字数。 */
function collectText(node: JSONContent): string {
  let text = node.type === "text" && node.text ? node.text : "";
  for (const child of node.content ?? []) text += collectText(child);
  return text;
}

/**
 * 把作者已采纳的审稿修改应用到 TipTap 正文。
 * 只改正文 JSON，不碰数据库；调用方负责保存与留快照。
 */
export function applyReviewEdits(raw: string, edits: ReviewEdit[]): ApplyEditsResult {
  const doc = parseDocument(raw);
  const appliedIds: string[] = [];
  const failedIds: string[] = [];

  for (const edit of edits) {
    if (!edit.quote || !edit.replacement) continue;
    const containers: JSONContent[] = [];
    textContainers(doc, containers);
    const applied = containers.some((container) =>
      replaceInContainer(container, edit.quote, edit.replacement),
    );
    (applied ? appliedIds : failedIds).push(edit.id);
  }

  return {
    content: JSON.stringify(doc),
    appliedIds,
    failedIds,
    wordCount: countCharacters(collectText(doc)),
  };
}
