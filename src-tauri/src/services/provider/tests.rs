//! Provider 服务的单测：默认种子、CRUD 往返、地址归一化、探测解析与 HTTP 回退。

use std::io::{Read, Write};
use std::net::TcpListener;

use super::*;
use crate::infrastructure::db;

fn temp_state(tag: &str) -> DbState {
    let dir = std::env::temp_dir().join(format!("ih-provider-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    db::open(&dir).unwrap()
}

fn sample_model() -> ProviderModel {
    ProviderModel {
        id: "deepseek-chat".into(),
        display_name: "DeepSeek Chat".into(),
        context_window: 64000,
        cost_per_1k_tokens: None,
    }
}

#[test]
fn default_ollama_provider_is_seeded_once() {
    let state = temp_state("seed");
    let providers = list(&state).unwrap();
    assert_eq!(providers.len(), 1);
    assert_eq!(providers[0].id, "ollama-local");
    assert_eq!(providers[0].source, "local");
    assert!(providers[0].enabled);
}

#[test]
fn deleted_default_provider_is_not_reseeded() {
    let dir = std::env::temp_dir().join(format!("ih-provider-reseed-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    {
        let state = db::open(&dir).unwrap();
        remove(&state, "ollama-local").unwrap();
        assert!(list(&state).unwrap().is_empty());
    }
    let reopened = db::open(&dir).unwrap();
    assert!(list(&reopened).unwrap().is_empty());
}

#[test]
fn save_generates_id_and_roundtrips_models() {
    let state = temp_state("crud");
    let saved = save(
        &state,
        &ProviderConfig {
            id: String::new(),
            name: " DeepSeek ".into(),
            source: "remote".into(),
            base_url: "https://api.deepseek.com/".into(),
            api_key_ref: Some("provider:deepseek".into()),
            enabled: true,
            models: vec![sample_model()],
        },
    )
    .unwrap();

    assert!(saved.id.starts_with("pv-"));
    assert_eq!(saved.name, "DeepSeek");
    assert_eq!(saved.base_url, "https://api.deepseek.com");
    assert_eq!(saved.models.len(), 1);
    assert_eq!(saved.models[0].context_window, 64000);

    let updated = save(
        &state,
        &ProviderConfig {
            name: "深度求索".into(),
            enabled: false,
            ..saved.clone()
        },
    )
    .unwrap();
    assert_eq!(updated.id, saved.id);
    assert_eq!(updated.name, "深度求索");
    assert!(!updated.enabled);

    // 本地 Provider 排在远端前面，方便用户第一眼看到。
    let providers = list(&state).unwrap();
    assert_eq!(providers.len(), 2);
    assert_eq!(providers[0].id, "ollama-local");

    remove(&state, &saved.id).unwrap();
    assert!(get(&state, &saved.id).unwrap().is_none());
}

#[test]
fn save_validates_required_fields() {
    let state = temp_state("validate");
    let base = ProviderConfig {
        id: String::new(),
        name: "x".into(),
        source: "local".into(),
        base_url: "http://localhost:11434/v1".into(),
        api_key_ref: None,
        enabled: true,
        models: vec![],
    };

    assert!(save(
        &state,
        &ProviderConfig {
            name: "  ".into(),
            ..base.clone()
        }
    )
    .is_err());
    assert!(save(
        &state,
        &ProviderConfig {
            source: "cloud".into(),
            ..base.clone()
        }
    )
    .is_err());
    assert!(save(
        &state,
        &ProviderConfig {
            base_url: "  ".into(),
            ..base.clone()
        }
    )
    .is_err());
}

#[test]
fn ollama_root_url_gets_v1_suffix() {
    assert_eq!(
        normalize_base_url("local", "http://localhost:11434"),
        "http://localhost:11434/v1"
    );
    assert_eq!(
        normalize_base_url("local", "http://127.0.0.1:11434/"),
        "http://127.0.0.1:11434/v1"
    );
    assert_eq!(
        normalize_base_url("local", "http://localhost:11434/v1"),
        "http://localhost:11434/v1"
    );
    // 云端地址不擅自补路径，交给用户填写完整 base_url。
    assert_eq!(
        normalize_base_url("remote", "https://api.deepseek.com"),
        "https://api.deepseek.com"
    );
}

#[test]
fn parse_models_supports_openai_and_ollama_shapes() {
    let openai = parse_models(r#"{"data":[{"id":"gpt-4o"},{"id":"gpt-4o"},{"id":""}]}"#).unwrap();
    assert_eq!(openai, vec!["gpt-4o"]);

    let ollama = parse_models(r#"{"models":[{"name":"llama3:8b"},{"model":"qwen2.5"}]}"#).unwrap();
    assert_eq!(ollama, vec!["llama3:8b", "qwen2.5"]);

    assert!(parse_models("not json").is_none());
    assert!(parse_models(r#"{"object":"list"}"#).is_none());
}

/// 起一个最小 HTTP 服务：/v1/models 返回 OpenAI 形状，其余路径 404。
fn spawn_probe_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().take(4) {
            let Ok(mut stream) = stream else { continue };
            let mut buffer = [0u8; 1024];
            let Ok(size) = stream.read(&mut buffer) else {
                continue;
            };
            let request = String::from_utf8_lossy(&buffer[..size]);
            let path = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("");
            if path == "/v1/models" {
                let body = r#"{"data":[{"id":"llama3.2"}]}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            } else {
                let _ = stream.write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
        }
    });
    port
}

#[tokio::test]
async fn probe_falls_back_to_v1_models() {
    let port = spawn_probe_server();
    let models = probe(&ProbeProviderInput {
        base_url: format!("http://127.0.0.1:{port}"),
        api_key: None,
        api_key_ref: None,
    })
    .await
    .unwrap();
    assert_eq!(models, vec!["llama3.2"]);
}
