use serde::Serialize;

/// 某个作品的检索索引状态。前端据此提示「没建索引 / 索引过期 / 段数」。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagStatus {
    /// 已索引的片段数（设定 + 章节正文）。
    pub chunks: i64,
    /// 最后一次索引时间（ISO8601）；从未索引过为 None。
    pub indexed_at: Option<String>,
    /// 向量维度；没建过索引为 None。
    pub dim: Option<i64>,
    /// 当前用于检索的模型标识（`providerId:modelId`）。
    pub model: Option<String>,
    /// 设定或正文在索引之后又改过 → 索引过期，建议重建。
    pub stale: bool,
    /// 是否已经选到了可用的 embedding 模型；false 时前端引导去模型管理页配置。
    pub embedding_ready: bool,
}

/// 一条检索命中。content 直接拼进提示词，所以只带必要元数据。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagHit {
    /// element（设定条目）或 chapter（章节正文片段）。
    pub kind: String,
    /// 设定名或「第N幕 · 章节名」。
    pub title: String,
    pub content: String,
    /// 向量距离，越小越接近；仅用于调试与排序。
    pub distance: f64,
}
