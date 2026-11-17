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
