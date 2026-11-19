use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// 设定库条目：人物 / 地点 / 组织 / 术语 / 时间线事件。
/// 扩展字段（别名、时间范围、关系等）统一放在 detail JSON 中。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryElement {
    pub id: String,
    pub project_id: String,
    /// character | place | org | term | event
    pub kind: String,
    pub name: String,
    pub summary: String,
    pub detail: Value,
    pub created_at: String,
    pub updated_at: String,
}

/// 全局设定库视图：条目 + 所属作品标题。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryElementOverview {
    #[serde(flatten)]
    pub element: StoryElement,
    pub project_title: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewStoryElement {
    pub project_id: String,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default = "empty_detail")]
    pub detail: Value,
}

fn empty_detail() -> Value {
    json!({})
}

/// 一致性检查结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyIssue {
    pub id: String,
    /// duplicate-name | timeline-conflict | invalid-time-range | broken-relation
    pub kind: String,
    /// warning | info
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub element_ids: Vec<String>,
}
