//! Embedding 调用：把文本批量转成向量，供 RAG 索引与检索使用。
//!
//! 不新增一套模型配置：embedding 模型就是 Provider 下勾选过的某个模型，
//! 统一走 OpenAI 兼容的 `/embeddings` 端点（Ollama 的 `/v1/embeddings` 是同一套）。

use std::time::Duration;

use reqwest::Client;
use serde_json::json;

use crate::infrastructure::{db::DbState, keychain};
use crate::models::ProviderConfig;
use crate::services::{gateway, provider, setting};

/// 用户在模型管理页选定的检索模型（`providerId:modelId`）。
pub const RAG_MODEL_KEY: &str = "rag_embedding_model";

/// 一次请求最多带多少条文本：本地模型批次太大容易超时，分批更稳。
const BATCH_SIZE: usize = 8;
/// embedding 首次调用可能要加载模型，给足时间。
const TIMEOUT_SECS: u64 = 120;

/// 名字里带这些片段的模型基本可以肯定是 embedding 模型，用作「没显式选过」时的兜底。
const EMBEDDING_HINTS: [&str; 5] = ["embed", "bge", "gte", "e5", "nomic"];

/// 一次调用要用哪个 Provider、哪个模型。
#[derive(Debug, Clone)]
pub struct EmbedTarget {
    pub provider: ProviderConfig,
    pub api_key: Option<String>,
    pub model: String,
    /// `providerId:modelId`，用于界面回显与去重。
    pub reference: String,
}

/// 解析检索用模型：优先用模型管理页存下的选择，没有再按模型名兜底猜一个。
///
/// 设为仅本地处理的作品，正文不能被送去云端做向量化，否则隐私承诺就破了；
/// 因此 RAG 的建索引与检索都要按作品的 privacy 传 `local_only`。
pub fn resolve_target_for(state: &DbState, local_only: bool) -> Result<EmbedTarget, String> {
    let providers = provider::list(state)?;
    if providers.is_empty() {
        return Err("还没有配置任何 Provider，请先在模型管理页添加".into());
    }

    if let Some(saved) = setting::get(state, RAG_MODEL_KEY)? {
        let saved = saved.trim().to_string();
        if !saved.is_empty() {
            return locate(&providers, &saved, local_only).ok_or_else(|| {
                if local_only && locate(&providers, &saved, false).is_some() {
                    format!("检索模型 {saved} 不是本地模型，仅本地作品不能把正文送去云端向量化")
                } else {
                    format!("检索模型 {saved} 已不可用，请在模型管理页重新选择")
                }
            });
        }
    }

    guess(&providers, local_only).ok_or_else(|| {
        if local_only {
            "没有找到本地 embedding 模型，请先用 Ollama 拉取 nomic-embed-text 一类模型".to_string()
        } else {
            "没有找到 embedding 模型，请在模型管理页把检索模型设为 nomic-embed-text 这类模型"
                .to_string()
        }
    })
}

/// 按 `providerId:modelId` 精确找；Provider 必须仍处于启用状态。
fn locate(providers: &[ProviderConfig], reference: &str, local_only: bool) -> Option<EmbedTarget> {
    let (provider_id, model) = gateway::split_model_ref(reference);
    let provider_id = provider_id?;
    let provider = providers
        .iter()
        .find(|p| p.id == provider_id && p.enabled && (!local_only || p.source == "local"))?;
    Some(build(provider, model.to_string(), reference.to_string()))
}

/// 没显式配置时按名字猜：勾了 `nomic-embed-text` 这类模型就直接用。
fn guess(providers: &[ProviderConfig], local_only: bool) -> Option<EmbedTarget> {
    for provider in providers
        .iter()
        .filter(|p| p.enabled && (!local_only || p.source == "local"))
    {
        for model in &provider.models {
            let name = model.id.to_ascii_lowercase();
            if EMBEDDING_HINTS.iter().any(|hint| name.contains(hint)) {
                let reference = format!("{}:{}", provider.id, model.id);
                return Some(build(provider, model.id.clone(), reference));
            }
        }
    }
    None
}

fn build(provider: &ProviderConfig, model: String, reference: String) -> EmbedTarget {
    let api_key = provider
        .api_key_ref
        .as_ref()
        .and_then(|key| keychain::get(key).ok().flatten());
    EmbedTarget {
        provider: provider.clone(),
        api_key,
        model,
        reference,
    }
}

/// 一次 embedding 的结果：向量按入参顺序对齐，`reference` 用于回显当前模型。
pub struct EmbedResult {
    pub vectors: Vec<Vec<f32>>,
    pub reference: String,
}

/// 把一批文本转成向量。空输入视为调用方 bug，直接报错而不是返回空数组。
///
/// `local_only` 由调用方按作品隐私传入：为真时只允许本地 Provider。
pub async fn embed_texts(
    state: &DbState,
    texts: &[String],
    local_only: bool,
) -> Result<EmbedResult, String> {
    if texts.is_empty() {
        return Err("没有需要向量化的文本".into());
    }
    let target = resolve_target_for(state, local_only)?;
    let url = format!(
        "{}/embeddings",
        target.provider.base_url.trim_end_matches('/')
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;

    let mut vectors = Vec::with_capacity(texts.len());
    for batch in texts.chunks(BATCH_SIZE) {
        let mut request = client
            .post(&url)
            .json(&json!({ "model": target.model, "input": batch }));
        if let Some(key) = &target.api_key {
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("请求 embedding 服务失败：{e}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let brief: String = body.chars().take(300).collect();
            return Err(format!("embedding 服务返回 {status}：{brief}"));
        }
        let value: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("解析 embedding 响应失败：{e}"))?;
        vectors.extend(parse_embeddings(&value, batch.len())?);
    }

    Ok(EmbedResult {
        vectors,
        reference: target.reference,
    })
}

/// 解析 OpenAI 兼容的 embedding 响应；按 `index` 还原顺序，不依赖服务端返回次序。
fn parse_embeddings(value: &serde_json::Value, expected: usize) -> Result<Vec<Vec<f32>>, String> {
    let data = value
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or("embedding 响应缺少 data 字段")?;

    let mut items: Vec<(usize, Vec<f32>)> = Vec::with_capacity(data.len());
    for (fallback, item) in data.iter().enumerate() {
        let index = item
            .get("index")
            .and_then(|i| i.as_u64())
            .map(|i| i as usize)
            .unwrap_or(fallback);
        let embedding = item
            .get("embedding")
            .and_then(|e| e.as_array())
            .ok_or("embedding 响应缺少 embedding 字段")?;
        let vector: Vec<f32> = embedding
            .iter()
            .filter_map(|v| v.as_f64())
            .map(|v| v as f32)
            .collect();
        if vector.is_empty() {
            return Err("embedding 返回了空向量".into());
        }
        items.push((index, vector));
    }

    if items.len() != expected {
        return Err(format!(
            "embedding 返回 {} 条，期望 {expected} 条",
            items.len()
        ));
    }
    items.sort_by_key(|(index, _)| *index);

    // 同一次请求的向量维度必须一致：维度混着写进 vec0，KNN 会直接报错。
    let dim = items[0].1.len();
    if items.iter().any(|(_, vector)| vector.len() != dim) {
        return Err("embedding 返回的向量维度不一致".into());
    }
    Ok(items.into_iter().map(|(_, vector)| vector).collect())
}

#[cfg(test)]
mod tests {
    use super::parse_embeddings;

    /// 服务端可能乱序返回，必须按 index 还原成入参顺序。
    #[test]
    fn parse_sorts_by_index() {
        let value = serde_json::json!({
            "data": [
                { "index": 1, "embedding": [0.0, 1.0] },
                { "index": 0, "embedding": [1.0, 0.0] }
            ]
        });
        let vectors = parse_embeddings(&value, 2).unwrap();
        assert_eq!(vectors[0], vec![1.0, 0.0]);
        assert_eq!(vectors[1], vec![0.0, 1.0]);
    }

    #[test]
    fn parse_rejects_count_mismatch() {
        let value = serde_json::json!({ "data": [{ "index": 0, "embedding": [1.0] }] });
        assert!(parse_embeddings(&value, 2).is_err());
    }

    #[test]
    fn parse_rejects_ragged_vectors() {
        let value = serde_json::json!({
            "data": [
                { "index": 0, "embedding": [1.0, 0.0] },
                { "index": 1, "embedding": [1.0, 0.0, 0.0] }
            ]
        });
        assert!(parse_embeddings(&value, 2).is_err());
    }
}
