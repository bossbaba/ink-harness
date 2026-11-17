/** 检索命中的来源类型：设定条目或章节正文片段。 */
export type RagHitKind = "element" | "chapter";

/** 某作品的检索索引状态（后端 rag_status）。 */
export interface RagStatus {
  /** 已索引片段数。 */
  chunks: number;
  /** 最后索引时间；从未索引为 null。 */
  indexedAt: string | null;
  /** 向量维度；没建过索引为 null。 */
  dim: number | null;
  /** 建索引时用的模型（`providerId:modelId`）。 */
  model: string | null;
  /** 索引之后设定或正文又改过、或换了模型 → 建议重建。 */
  stale: boolean;
  /** 是否已选到可用的 embedding 模型。 */
  embeddingReady: boolean;
}

/** 一条检索命中。 */
export interface RagHit {
  kind: RagHitKind;
  title: string;
  content: string;
  distance: number;
}

export const RAG_HIT_KIND_LABEL: Record<RagHitKind, string> = {
  element: "设定",
  chapter: "正文",
};
