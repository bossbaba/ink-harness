use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub genre: String,
    pub premise: String,
    pub audience: String,
    pub style: String,
    /// any | local-only
    pub privacy: String,
    /// idea/outline/drafting/review/published
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 新建作品的输入（id/时间戳由服务端生成）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub title: String,
    #[serde(default)]
    pub genre: String,
    #[serde(default)]
    pub premise: String,
    #[serde(default)]
    pub audience: String,
    #[serde(default)]
    pub style: String,
    #[serde(default = "default_privacy")]
    pub privacy: String,
}

fn default_privacy() -> String {
    "any".into()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub path: String,
}
