import type { ToolActionPreview, ToolActionPreviewItem } from "@/types";

/**
 * 写操作审批预览：把工具参数里的结构化改动拆成逐条「原文 → 替换」列表。
 *
 * 只有 apply_edits 这类带 edits 数组的工具能生成预览；propose_text 等纯文本工具
 * 没有可对照的原文，交给调用方展示完整内容即可。
 * 入参必须是已脱敏的参数——预览里的替换文字要和真正写入正文的内容一致。
 */

/** 展示截断长度：审批卡片是消息流里的窄面板，单条超过这个长度就折叠显示。 */
const PREVIEW_MAX_LEN = 120;

/** 按显示需要截断；超长时保留尾部省略号，并标记 truncated 提醒作者完整内容仍会写入。 */
function clip(text: string): { text: string; truncated: boolean } {
  if (text.length <= PREVIEW_MAX_LEN) return { text, truncated: false };
  return { text: `${text.slice(0, PREVIEW_MAX_LEN)}…`, truncated: true };
}

/**
 * 生成审批预览；不适用或无有效条目时返回 undefined，UI 就不渲染差异区。
 *
 * @param toolName 工具名，目前只对 apply_edits 生成预览
 * @param args 已经脱敏的工具参数
 */
export function buildWritePreview(
  toolName: string,
  args: Record<string, unknown>,
): ToolActionPreview | undefined {
  if (toolName !== "apply_edits" || !Array.isArray(args.edits)) return undefined;

  const items: ToolActionPreviewItem[] = [];
  let skipped = 0;
  args.edits.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      skipped += 1;
      return;
    }
    const { quote, replacement } = raw as { quote?: unknown; replacement?: unknown };
    if (typeof quote !== "string" || !quote.trim() || typeof replacement !== "string") {
      skipped += 1;
      return;
    }
    const quoteView = clip(quote);
    const replacementView = clip(replacement);
    items.push({
      id: `preview-${index}`,
      quote: quoteView.text,
      replacement: replacementView.text,
      // 原文或替换文字任一超长都算截断，两处都要给作者明确提示。
      truncated: quoteView.truncated || replacementView.truncated,
    });
  });

  const chapterId = typeof args.chapterId === "string" && args.chapterId ? args.chapterId : "";
  return { target: chapterId ? `章节 ${chapterId}` : "当前章节", items, skipped };
}
