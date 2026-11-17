use serde::{Deserialize, Serialize};

/// 章节：按幕（1/2/3）分列，sort_order 在同一幕内递增。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub project_id: String,
    /// 1 / 2 / 3 对应第一幕、第二幕、第三幕
    pub act: i64,
    pub title: String,
    pub summary: String,
    /// planned | drafting | done
    pub status: String,
    /// 正文非空白字符数；只带计数不带正文，列表页够用。
    pub word_count: i64,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewChapter {
    pub project_id: String,
    pub act: i64,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default = "default_status")]
    pub status: String,
}

fn default_status() -> String {
    "planned".into()
}

/// 场景：挂在章节下，携带 POV / 地点 / 时间标记，是 AI 续写的最小上下文单元。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub chapter_id: String,
    pub title: String,
    pub pov: String,
    pub location: String,
    pub time_mark: String,
    pub summary: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewScene {
    pub chapter_id: String,
    pub title: String,
    #[serde(default)]
    pub pov: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub time_mark: String,
    #[serde(default)]
    pub summary: String,
}

/// 伏笔：记录「铺设章节 → 回收章节」，用于追踪未回收的线索。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Foreshadow {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub setup_chapter_id: Option<String>,
    pub payoff_chapter_id: Option<String>,
    /// planned | setup | paid-off
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewForeshadow {
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub setup_chapter_id: Option<String>,
    #[serde(default)]
    pub payoff_chapter_id: Option<String>,
    #[serde(default = "default_status")]
    pub status: String,
}

/// 大纲看板一次性拉取的全量数据，减少前端多次往返。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineSnapshot {
    pub chapters: Vec<Chapter>,
    pub scenes: Vec<Scene>,
    pub foreshadows: Vec<Foreshadow>,
}

/// 章节跨幕拖拽：目标幕 + 在该幕中的插入下标（0 起）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveChapter {
    pub project_id: String,
    pub chapter_id: String,
    pub target_act: i64,
    pub target_index: usize,
}

/// 场景跨章拖拽：目标章节 + 在该章中的插入下标（0 起）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveScene {
    pub scene_id: String,
    pub target_chapter_id: String,
    pub target_index: usize,
}
