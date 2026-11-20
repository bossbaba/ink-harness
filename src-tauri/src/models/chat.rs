use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// tool 角色消息对应的调用 id，上游据此把结果匹配到上一次的工具请求。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// tool 角色消息的工具名，部分上游要求携带。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// assistant 消息里模型给出的工具调用（完整结构），透传给上游以维持多轮对话。
    /// 用 Value 透传，避免为不同 Provider 的细微差异建强类型。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<serde_json::Value>,
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
    /// 本次可用的工具定义（OpenAI 兼容的 function schema）。空数组表示普通对话，
    /// 非空时上游会在需要时返回 tool_calls 而不是正文。用 Value 透传而非强类型：
    /// 不同 Provider 对 schema 的容忍度不一，强类型会在网关层就挡掉上游其实接受的描述字段。
    #[serde(default)]
    pub tools: Vec<serde_json::Value>,
}

/// 流式返回的一个工具调用片段。
///
/// OpenAI 的 SSE 把一次调用拆成多帧：id 与 name 只在首帧给出，arguments 是逐块追加的
/// JSON 片段；Ollama 原生接口则一次给全、arguments 已是对象。两者都归一成这个结构，
/// 由前端按 index 拼接成完整调用，Rust 侧不做跨帧累积以免把会话状态带进无状态的解析层。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallChunk {
    /// 同一次响应里多个工具的序号，用来拼接分片。
    pub index: usize,
    /// 调用 id，首帧有值、后续帧为空串；Ollama 原生不提供时用 name 兜底生成。
    #[serde(default)]
    pub id: String,
    /// 工具名，首帧有值、后续帧为空串。
    #[serde(default)]
    pub name: String,
    /// 参数 JSON 文本（增量）；全部拼完才是合法 JSON。
    #[serde(default)]
    pub arguments: String,
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
    /// 工具调用片段；普通文本块为空数组。
    #[serde(default)]
    pub tool_calls: Vec<ToolCallChunk>,
    /// 上游返回的 token 用量；只在流末尾出现一次，其余块不带此字段。
    /// 前端据此给 Agent 轨迹记账（成本聚合），没有它轨迹里的 tokens 只能写 0。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
}

impl ChatChunk {
    pub fn delta(text: impl Into<String>) -> Self {
        Self {
            delta: text.into(),
            done: false,
            tool_calls: Vec::new(),
            usage: None,
        }
    }

    /// 把解析出的工具片段包成一块发给前端。
    pub fn tool_call(call: ToolCallChunk) -> Self {
        Self {
            delta: String::new(),
            done: false,
            tool_calls: vec![call],
            usage: None,
        }
    }

    /// 把流末尾的 token 用量单独发一块给前端；在 done 之前到达。
    pub fn usage(usage: TokenUsage) -> Self {
        Self {
            delta: String::new(),
            done: false,
            tool_calls: Vec::new(),
            usage: Some(usage),
        }
    }

    pub fn done() -> Self {
        Self {
            delta: String::new(),
            done: true,
            tool_calls: Vec::new(),
            usage: None,
        }
    }
}
