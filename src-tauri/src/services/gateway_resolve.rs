//! 网关的 Provider 解析（纯逻辑为主）：把路由用的 `providerId:modelId` 解析成
//! 「打到哪个 Provider、用哪个模型名、带哪把钥匙」。从 gateway.rs 拆出以控制单文件规模。

use crate::error::AppError;
use crate::infrastructure::{db::DbState, keychain};
use crate::models::{ChatParams, ProviderConfig, split_model_ref};
use crate::services::provider;

/// 一次对话实际要打到哪个 Provider、用哪个模型名。
pub struct ResolvedProvider {
    pub provider: ProviderConfig,
    pub api_key: Option<String>,
    /// 真正发给上游的模型名（已去掉 `providerId:` 前缀）。
    pub model: String,
}

pub fn resolve_provider(
    state: &DbState,
    params: &ChatParams,
) -> Result<ResolvedProvider, AppError> {
    let providers = provider::list(state)?;
    let (provider, model) = locate_provider(&providers, &params.model).ok_or_else(|| {
        format!(
            "未找到模型 {} 对应的 Provider，请先在模型管理中配置",
            params.model
        )
    })?;

    let reference = provider.api_key_ref.as_deref();
    let stored = keychain::resolve(reference)?;
    let api_key = require_api_key(&provider.name, reference, stored)?;

    Ok(ResolvedProvider {
        provider,
        api_key,
        model,
    })
}

/// 数据库里写了密钥引用、钥匙串里却取不到密钥时必须在本地报错。
/// 否则网关会不带 Authorization 直接打上游，用户只能收到看不懂的 401。
pub fn require_api_key(
    provider_name: &str,
    reference: Option<&str>,
    stored: Option<String>,
) -> Result<Option<String>, AppError> {
    match (reference, stored) {
        (Some(_), Some(key)) => Ok(Some(key)),
        (Some(_), None) => Err(AppError::validation(format!(
            "Provider「{provider_name}」显示已保存密钥，但系统钥匙串中找不到对应条目；请在模型管理中重新填入 API Key 并保存。"
        ))),
        (None, _) => Ok(None),
    }
}

/// 按模型标识找到 Provider，并给出真正要发给上游的模型名。
///
/// 正常路径是 `providerId:modelId`；兼容旧调用（只给模型名）时退回「以 provider id 开头 →
/// 本地 Provider → 任意启用 Provider」。前缀写了但 Provider 不存在、整串又不是某个已登记模型名时
/// 直接返回 None：与其把 `typo:model` 当模型名发给上游换回一个莫名 400，不如在界面上说清楚。
fn locate_provider(
    providers: &[ProviderConfig],
    reference: &str,
) -> Option<(ProviderConfig, String)> {
    let (provider_id, model) = split_model_ref(reference);
    if let Some(id) = provider_id {
        if let Some(found) = providers.iter().find(|p| p.id == id) {
            return Some((found.clone(), model.to_string()));
        }
        let is_known_model = providers
            .iter()
            .any(|p| p.models.iter().any(|m| m.id == reference));
        if !is_known_model {
            return None;
        }
    }

    let fallback = providers
        .iter()
        .find(|p| p.enabled && reference.starts_with(&p.id))
        .or_else(|| providers.iter().find(|p| p.enabled && p.source == "local"))
        .or_else(|| providers.iter().find(|p| p.enabled))?;
    Some((fallback.clone(), reference.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ProviderModel;

    fn provider(id: &str, source: &str, enabled: bool, models: &[&str]) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            name: id.to_string(),
            source: source.to_string(),
            base_url: format!("http://{id}/v1"),
            api_key_ref: None,
            enabled,
            models: models
                .iter()
                .map(|m| ProviderModel {
                    id: m.to_string(),
                    display_name: m.to_string(),
                    context_window: 8192,
                    cost_per_1k_tokens: None,
                    supports_tools: false,
                })
                .collect(),
        }
    }

    #[test]
    fn split_model_ref_keeps_ollama_tag_after_first_colon() {
        // Ollama 的模型名自己带冒号，必须整段保留，否则会拿 `qwen2.5` 去打 tag 为 `qwen2.5:7b` 的模型。
        assert_eq!(
            split_model_ref("ollama-local:qwen2.5:7b"),
            (Some("ollama-local"), "qwen2.5:7b")
        );
        assert_eq!(split_model_ref("gpt-4o"), (None, "gpt-4o"));
        // 空段一律当「没有前缀」，避免把空 provider id 当成有效标识。
        assert_eq!(split_model_ref(":gpt-4o"), (None, ":gpt-4o"));
        assert_eq!(split_model_ref("ollama-local:"), (None, "ollama-local:"));
    }

    #[test]
    fn locate_provider_strips_router_prefix() {
        let providers = vec![provider("ollama-local", "local", true, &["qwen2.5:7b"])];
        let (found, model) =
            locate_provider(&providers, "ollama-local:qwen2.5:7b").expect("应命中");
        assert_eq!(found.id, "ollama-local");
        assert_eq!(model, "qwen2.5:7b");
    }

    #[test]
    fn locate_provider_accepts_bare_model_name() {
        // 旧调用只给模型名：退到本地 Provider，模型名原样透传。
        let providers = vec![provider("ollama-local", "local", true, &["qwen2.5:7b"])];
        let (found, model) =
            locate_provider(&providers, "qwen2.5:7b").expect("应命中本地 Provider");
        assert_eq!(found.id, "ollama-local");
        assert_eq!(model, "qwen2.5:7b");
    }

    #[test]
    fn locate_provider_rejects_unknown_prefix() {
        // 前缀写错时不能悄悄回退到本地 Provider，否则上游只会回一个看不懂的 400。
        let providers = vec![provider("ollama-local", "local", true, &["qwen2.5:7b"])];
        assert!(locate_provider(&providers, "olama-local:qwen2.5:7b").is_none());
    }

    #[test]
    fn locate_provider_skips_disabled_when_falling_back() {
        let providers = vec![
            provider("remote-a", "remote", false, &["gpt-4o"]),
            provider("local-b", "local", true, &["qwen2.5:7b"]),
        ];
        let (found, _) =
            locate_provider(&providers, "unknown-name").expect("应回退到启用的本地 Provider");
        assert_eq!(found.id, "local-b");
    }

    #[test]
    fn missing_keychain_entry_for_reference_is_a_validation_error() {
        // 界面显示「已保存密钥」但钥匙串没条目时，必须先在本地报错，不能裸发请求换 401。
        let err = require_api_key("XiaoMiMiMo", Some("provider:p-1"), None).expect_err("应报错");
        assert_eq!(err.code, crate::error::ErrorCode::Validation);
        assert!(err.message.contains("XiaoMiMiMo"));
        assert!(err.message.contains("重新填入"));
    }

    #[test]
    fn api_key_is_optional_only_when_no_reference_is_recorded() {
        assert_eq!(require_api_key("Local", None, None).expect("无需密钥"), None);
        assert_eq!(
            require_api_key("Remote", Some("provider:p-1"), Some("sk-1".to_string()))
                .expect("应取到密钥")
                .as_deref(),
            Some("sk-1")
        );
    }
}
