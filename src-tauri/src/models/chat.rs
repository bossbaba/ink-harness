use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatParams {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// 该作品是否仅允许本地模型处理（隐私分级）。
    #[serde(default)]
    pub privacy_local_only: bool,
    /// 任务类型，仅用于统计；缺省时不记入 agent_run。
    #[serde(default)]
    pub task_kind: Option<String>,
    /// 作品 ID，仅用于统计；agent_run.project_id 是外键，没有作品就不写记录。
    #[serde(default)]
    pub project_id: Option<String>,
}

/// 流式响应末尾的 token 用量。上游不一定给，拿不到就是 None。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    #[serde(alias = "prompt_tokens")]
    pub prompt_tokens: u32,
    #[serde(alias = "completion_tokens")]
    pub completion_tokens: u32,
    #[serde(alias = "total_tokens")]
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatChunk {
    /// 增量文本；结束时为空串。
    pub delta: String,
    /// 是否为最后一块。
    pub done: bool,
}

impl ChatChunk {
    pub fn delta(text: impl Into<String>) -> Self {
        Self {
            delta: text.into(),
            done: false,
        }
    }

    pub fn done() -> Self {
        Self {
            delta: String::new(),
            done: true,
        }
    }
}
