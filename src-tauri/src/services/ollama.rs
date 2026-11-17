//! Ollama 服务检测领域服务。

use crate::infrastructure::llm_http;
use crate::models::OllamaStatus;

pub async fn check() -> Result<OllamaStatus, String> {
    let client = llm_http::probe_client()?;

    let running = client
        .get(llm_http::OLLAMA_TAGS_URL)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    let models = if running {
        fetch_models(&client).await.unwrap_or_default()
    } else {
        vec![]
    };

    Ok(OllamaStatus {
        installed: running, // 服务在跑 implies 已安装；CLI 检测留待 P8
        running,
        models,
    })
}

async fn fetch_models(client: &reqwest::Client) -> Result<Vec<String>, String> {
    #[derive(serde::Deserialize)]
    struct TagsResponse {
        models: Vec<TagsModel>,
    }
    #[derive(serde::Deserialize)]
    struct TagsModel {
        name: String,
    }

    let res = client
        .get(llm_http::OLLAMA_TAGS_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let tags: TagsResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(tags.models.into_iter().map(|m| m.name).collect())
}
