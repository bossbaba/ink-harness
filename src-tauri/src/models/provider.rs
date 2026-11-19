use serde::{Deserialize, Serialize};

/// Provider 下被启用的模型。上下文窗口用于路由，supports_tools 决定该模型
/// 能否走工具调用（Agent Loop 依赖此能力）；不能的模型会走 JSON 降级轨。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default = "default_context_window")]
    pub context_window: i64,
    #[serde(default)]
    pub cost_per_1k_tokens: Option<f64>,
    /// 是否支持 function/tool calling。默认 false：老配置与新探测的模型都需作者显式勾选，
    /// 避免把不支持的模型误判为可用、发出工具请求后拿到无关输出。
    #[serde(default)]
    pub supports_tools: bool,
}

fn default_context_window() -> i64 {
    8192
}

/// Provider 配置（不含密钥本体，密钥存系统钥匙串）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    /// "local" 或 "remote"
    pub source: String,
    /// 例：http://localhost:11434/v1
    pub base_url: String,
    /// 系统钥匙串条目键名（非密钥明文）
    #[serde(default)]
    pub api_key_ref: Option<String>,
    pub enabled: bool,
    /// 已启用模型列表；由模型管理页探测后勾选写入。
    #[serde(default)]
    pub models: Vec<ProviderModel>,
}

/// 探测连接用的入参：允许在保存前用未落库的密钥测试。
/// 已保存过密钥的 Provider 可只传 `api_key_ref`，由后端从钥匙串取明文。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeProviderInput {
    pub base_url: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_key_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub installed: bool,
    pub running: bool,
    pub models: Vec<String>,
}

/// 把路由用的模型标识拆成 (providerId, modelId)。
///
/// 模型名自己也可能带冒号（Ollama 的 `qwen2.5:7b`），所以只按**第一个**冒号切一次，
/// 剩下的整体当模型名；没有冒号或切出空串时视为「只有模型名」。
pub fn split_model_ref(reference: &str) -> (Option<&str>, &str) {
    match reference.split_once(':') {
        Some((provider_id, model_id)) if !provider_id.is_empty() && !model_id.is_empty() => {
            (Some(provider_id), model_id)
        }
        _ => (None, reference),
    }
}
