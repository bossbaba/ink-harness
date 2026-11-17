use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub installed: bool,
    pub running: bool,
    pub models: Vec<String>,
}
