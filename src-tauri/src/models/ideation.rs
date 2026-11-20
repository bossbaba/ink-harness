//! 构思向导草稿：一个作品一份，存访谈答案与生成方案。

use serde::{Deserialize, Serialize};

/// 读取用的草稿结构。
///
/// `answersJson` / `proposalJson` 保持原始字符串：问卷与方案的结构会随产品迭代，
/// 后端只负责存取，解析与兼容交给前端，避免每次加字段都要动 Rust。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeationDraft {
    pub project_id: String,
    /// 访谈答案 JSON；空串表示还没填过。
    pub answers_json: String,
    /// 生成方案 JSON；空串表示还没生成或已重置。
    pub proposal_json: String,
    pub step: i64,
    pub max_step: i64,
    pub selected_title: String,
    pub include_outline: bool,
    pub applied: bool,
    pub outline_created: bool,
    pub updated_at: String,
}

/// 写入用的草稿入参；`project_id` 必填，其余字段缺省时按「空草稿」处理。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeationDraftInput {
    pub project_id: String,
    #[serde(default)]
    pub answers_json: String,
    #[serde(default)]
    pub proposal_json: String,
    #[serde(default)]
    pub step: i64,
    #[serde(default)]
    pub max_step: i64,
    #[serde(default)]
    pub selected_title: String,
    /// 缺省视为勾选：多数作者希望顺手生成三幕骨架，漏传不该变成「不生成」。
    #[serde(default = "default_true")]
    pub include_outline: bool,
    #[serde(default)]
    pub applied: bool,
    #[serde(default)]
    pub outline_created: bool,
}

fn default_true() -> bool {
    true
}
