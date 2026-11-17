use serde::{Deserialize, Serialize};

/// 章节正文：与大清单里的章节元数据分开取，列表页不必把每章几十 KB 的正文都拖下来。
/// content 存 TipTap 的文档 JSON 字符串，空串表示这一章还没写过。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterContent {
    pub chapter_id: String,
    pub content: String,
    /// 非空白字符数，由前端编辑器统计后回写，后端只负责持久化与按需校验。
    pub word_count: i64,
    pub updated_at: String,
}

/// 保存正文的入参。snapshot 为 true 时强制留一版快照（页面上的「保存快照」）。
/// 自动保存不带 snapshot，是否留快照由服务端按差异阈值决定。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveContentInput {
    pub chapter_id: String,
    pub content: String,
    #[serde(default)]
    pub word_count: i64,
    #[serde(default)]
    pub snapshot: bool,
}

/// 版本列表项：不带 content，避免一次拉回几十份全文。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftVersionBrief {
    pub id: String,
    pub chapter_id: String,
    pub version: i64,
    pub word_count: i64,
    pub created_at: String,
}

/// 单个版本的完整内容，用于恢复正文与预览。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftVersion {
    pub id: String,
    pub chapter_id: String,
    pub version: i64,
    pub content: String,
    pub word_count: i64,
    pub created_at: String,
}
