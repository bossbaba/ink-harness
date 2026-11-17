//! Provider 领域服务：SQLite 持久化 + 连接探测（拉取可用模型列表）。
//! 密钥本体不进数据库，只存钥匙串引用键名；探测允许临时传入未落库的密钥。

use std::collections::HashSet;
use std::time::Duration;

use rusqlite::{params, OptionalExtension};

use crate::infrastructure::{db::DbState, id::gen_id, keychain, llm_http};
use crate::models::{ProbeProviderInput, ProviderConfig, ProviderModel};

const COLUMNS: &str = "id, name, source, base_url, api_key_ref, enabled, models_json";

fn row_to_provider(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProviderConfig> {
    let raw: String = row.get(6)?;
    // JSON 解析失败时退化为空模型列表，不让一条脏数据拖垮整个管理页。
    let models = serde_json::from_str::<Vec<ProviderModel>>(&raw).unwrap_or_default();
    Ok(ProviderConfig {
        id: row.get(0)?,
        name: row.get(1)?,
        source: row.get(2)?,
        base_url: row.get(3)?,
        api_key_ref: row.get(4)?,
        enabled: row.get::<_, i64>(5)? != 0,
        models,
    })
}

pub fn list(state: &DbState) -> Result<Vec<ProviderConfig>, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!(
            "select {COLUMNS} from provider_config \
             order by case source when 'local' then 0 else 1 end, name collate nocase"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_provider)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get(state: &DbState, id: &str) -> Result<Option<ProviderConfig>, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        &format!("select {COLUMNS} from provider_config where id = ?1"),
        params![id],
        row_to_provider,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// 本地 Ollama 常见误填 http://localhost:11434（缺 /v1），保存时补全，避免对话请求 404。
fn normalize_base_url(source: &str, raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    let is_ollama_root = source == "local"
        && (trimmed == "http://localhost:11434" || trimmed == "http://127.0.0.1:11434");
    if is_ollama_root {
        format!("{trimmed}/v1")
    } else {
        trimmed.to_string()
    }
}

/// 新增或更新 Provider；id 为空时由后端生成，返回落库后的完整配置。
pub fn save(state: &DbState, config: &ProviderConfig) -> Result<ProviderConfig, String> {
    let name = config.name.trim();
    if name.is_empty() {
        return Err("Provider 名称不能为空".into());
    }
    if config.source != "local" && config.source != "remote" {
        return Err("Provider 来源只能是 local 或 remote".into());
    }
    let base_url = normalize_base_url(&config.source, &config.base_url);
    if base_url.is_empty() {
        return Err("服务地址不能为空".into());
    }
    let id = if config.id.trim().is_empty() {
        gen_id("pv")
    } else {
        config.id.trim().to_string()
    };
    let models_json = serde_json::to_string(&config.models).map_err(|e| e.to_string())?;

    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    conn.execute(
        r#"insert into provider_config
           (id, name, source, base_url, api_key_ref, enabled, models_json, updated_at)
           values (?1, ?2, ?3, ?4, ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
           on conflict(id) do update set
             name = excluded.name,
             source = excluded.source,
             base_url = excluded.base_url,
             api_key_ref = excluded.api_key_ref,
             enabled = excluded.enabled,
             models_json = excluded.models_json,
             updated_at = excluded.updated_at"#,
        params![
            id,
            name,
            config.source,
            base_url,
            config.api_key_ref,
            if config.enabled { 1 } else { 0 },
            models_json
        ],
    )
    .map_err(|e| e.to_string())?;
    drop(conn);
    get(state, &id)?.ok_or_else(|| "保存后读取 Provider 失败".into())
}

pub fn remove(state: &DbState, id: &str) -> Result<(), String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    conn.execute("delete from provider_config where id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 依次尝试 OpenAI 兼容的 /models 与 Ollama 原生 /api/tags，返回模型 id 列表。
pub async fn probe(input: &ProbeProviderInput) -> Result<Vec<String>, String> {
    let base = input.base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("请填写服务地址".into());
    }
    // 优先用这次输入的密钥；编辑已保存的 Provider 时用户通常不会再输一遍，
    // 此时按 api_key_ref 从钥匙串取，避免「测试连接」对云端必 401。
    let api_key = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string)
        .or_else(|| {
            input
                .api_key_ref
                .as_deref()
                .and_then(|reference| keychain::get(reference).ok().flatten())
        });
    let api_key = api_key.as_deref();

    let mut urls = vec![format!("{base}/models")];
    if !base.ends_with("/v1") {
        urls.push(format!("{base}/v1/models"));
    }
    urls.push(format!("{base}/api/tags"));

    let client = llm_http::client();
    let mut last_error = String::new();
    for url in urls {
        let mut request = client.get(&url).timeout(Duration::from_secs(12));
        if let Some(key) = api_key {
            request = request.bearer_auth(key);
        }
        match request.send().await {
            Ok(response) if response.status().is_success() => {
                let raw = response.text().await.unwrap_or_default();
                if let Some(models) = parse_models(&raw) {
                    return Ok(models);
                }
                last_error = format!("{url} 返回的不是可识别的模型列表");
            }
            Ok(response) => last_error = format!("{url} 返回 HTTP {}", response.status()),
            Err(err) => last_error = format!("{url} 请求失败：{err}"),
        }
    }
    Err(format!("连接失败：{last_error}"))
}

/// 兼容 OpenAI（data[].id）与 Ollama（models[].name）两种响应；去重并保持原顺序。
fn parse_models(raw: &str) -> Option<Vec<String>> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let mut ids: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    let mut push = |id: &str| {
        let id = id.trim();
        if !id.is_empty() && seen.insert(id.to_string()) {
            ids.push(id.to_string());
        }
    };

    if let Some(items) = value.get("data").and_then(serde_json::Value::as_array) {
        for item in items {
            if let Some(id) = item.get("id").and_then(serde_json::Value::as_str) {
                push(id);
            }
        }
        return Some(ids);
    }
    if let Some(items) = value.get("models").and_then(serde_json::Value::as_array) {
        for item in items {
            if let Some(id) = item
                .get("name")
                .or_else(|| item.get("model"))
                .and_then(serde_json::Value::as_str)
            {
                push(id);
            }
        }
        return Some(ids);
    }
    None
}

#[cfg(test)]
mod tests;
