//! 全局统计 DTO：只读看板的汇总结构，与查询逻辑分离。

use serde::Serialize;

/// 某个分组维度的一行：key 是状态或 kind，count 是数量。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountItem {
    pub key: String,
    pub count: i64,
}

/// 全局统计总览：作品、章节、字数、设定与阶段分布。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStats {
    pub projects: i64,
    pub chapters: i64,
    pub total_words: i64,
    pub story_elements: i64,
    pub scenes: i64,
    pub foreshadows: i64,
    /// 作品按 status（idea/outline/...）分布，只返回有数据的档位。
    pub projects_by_status: Vec<CountItem>,
    /// 章节按 status（planned/drafting/done）分布。
    pub chapters_by_status: Vec<CountItem>,
    /// 设定条目按 kind（character/place/...）分布。
    pub elements_by_kind: Vec<CountItem>,
}
