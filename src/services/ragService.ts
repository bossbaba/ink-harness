import { tauriApi } from "@/api/tauri";
import { RAG_HIT_KIND_LABEL, type RagHit, type RagStatus } from "@/types";

/** 单条注入提示词的片段上限：检索是补充背景，不该挤掉作品上下文。 */
const NOTE_LIMIT = 360;

/** 检索索引领域服务：页面与组合式函数只依赖这个门面。 */
export const ragService = {
  status: (projectId: string): Promise<RagStatus> => tauriApi.ragStatus(projectId),

  reindex: (projectId: string): Promise<RagStatus> => tauriApi.ragReindex(projectId),

  search: (projectId: string, query: string, limit = 4): Promise<RagHit[]> =>
    tauriApi.ragSearch(projectId, query, limit),
};

/** 检索结果：拼好的提示词块 + 原始命中，后者用于界面显示「检索到几段」。 */
export interface RelatedNotes {
  block: string;
  hits: RagHit[];
}

/**
 * 取与当前问题相关的片段并拼成提示词块。
 *
 * 检索是「锦上添花」：没建索引、模型不可用、网络失败都返回空结果，
 * 让生成照常进行，而不是因为检索挂了就写不了字。
 */
export async function loadRelatedNotes(
  projectId: string,
  query: string,
  limit = 4,
): Promise<RelatedNotes> {
  const trimmed = query.trim();
  if (!trimmed) return { block: "", hits: [] };

  try {
    const hits = await ragService.search(projectId, trimmed, limit);
    if (hits.length === 0) return { block: "", hits: [] };
    const lines = hits.map((hit) => {
      const content =
        hit.content.length <= NOTE_LIMIT ? hit.content : `${hit.content.slice(0, NOTE_LIMIT)}…`;
      return `- ${RAG_HIT_KIND_LABEL[hit.kind]} · ${hit.title}：${content}`;
    });
    return { block: `【按问题检索到的资料】\n${lines.join("\n")}`, hits };
  } catch {
    return { block: "", hits: [] };
  }
}
