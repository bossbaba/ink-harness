import { EMPTY_REPLY_MESSAGE, runChat } from "@/services/aiChat";
import { buildBriefMessages } from "@/services/prompts/publicationBrief";
import type { PrivacyScope, PublicationBrief, PublishDocument } from "@/types";

// 兼容既有调用方：外部仍从本模块引用提示词构建函数。
export { buildBriefMessages };

/** 允许模型包一层代码块或塞前后废话，和审稿报告用同一套宽松解析。 */
function extractObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 解析失败返回 null，调用方把原文摆出来而不是只报一句失败。 */
export function parsePublicationBrief(raw: string): PublicationBrief | null {
  const data = extractObject(raw);
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const blurb = text(record.blurb);
  const coverBrief = text(record.coverBrief);
  const queryLetter = text(record.queryLetter);
  const tags = Array.isArray(record.tags)
    ? record.tags
        .map((tag) => text(tag))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  if (!blurb && !coverBrief && !queryLetter && tags.length === 0) return null;
  return { blurb, tags, coverBrief, queryLetter };
}

/** 请求模型生成物料，返回原文供解析与降级展示。 */
export async function requestPublicationBrief(
  doc: PublishDocument,
  privacy: PrivacyScope,
  projectId: string,
  onChunk?: (received: number) => void,
): Promise<string> {
  const { raw, failure } = await runChat(
    { task: "publish", privacy, projectId },
    buildBriefMessages(doc),
    onChunk,
  );
  if (failure) throw new Error(failure);
  if (!raw.trim()) throw new Error(EMPTY_REPLY_MESSAGE);
  return raw;
}
