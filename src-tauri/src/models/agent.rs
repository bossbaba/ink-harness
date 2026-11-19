use serde::{Deserialize, Serialize};

/// Agent 会话：一条 Copilot 对话线程，按作品隔离。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 会话里的一条消息；tool_calls 存序列化后的 JSON（空串表示没有）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub tool_calls: String,
    pub created_at: String,
}

/// Agent Loop 一轮的轨迹：工具调用、观察、token 与耗时。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepRecord {
    pub id: String,
    pub session_id: String,
    pub iteration: i64,
    #[serde(default)]
    pub tool_calls: String,
    #[serde(default)]
    pub observations: String,
    pub tokens: i64,
    pub latency_ms: i64,
    pub created_at: String,
}

/// 新建会话的入参。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAgentSession {
    pub project_id: String,
    #[serde(default)]
    pub title: String,
}

/// 追加一条消息的入参；id 由前端生成（与内存消息 id 对齐）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAgentMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub tool_calls: String,
}

/// 追加一步轨迹的入参。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAgentStep {
    pub session_id: String,
    pub iteration: i64,
    #[serde(default)]
    pub tool_calls: String,
    #[serde(default)]
    pub observations: String,
    #[serde(default)]
    pub tokens: i64,
    #[serde(default)]
    pub latency_ms: i64,
}
