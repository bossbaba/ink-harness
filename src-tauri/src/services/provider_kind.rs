//! Provider 方言：把「打哪个 URL、按什么格式解析模型列表」集中到这里。
//!
//! 之前这些判断散在三处：`gateway` 拼 `/chat/completions`、`provider` 探测三个候选地址、
//! `embed` 拼 `/embeddings`。接一家新的模型厂商要改三四个文件，还容易漏。
//! 现在协议差异只在本文件里出现，新增方言（如 Anthropic 的 `/v1/messages`）
//! 只需在这里加一个分支，调用方不用动。

use std::net::IpAddr;
use std::str::FromStr;

use crate::error::AppError;

/// Provider 来源标识：本地跑在自己机器上的服务，可以接收「仅本地」作品的正文。
pub const SOURCE_LOCAL: &str = "local";

/// 判断 Provider 的来源标识是否为 local。
///
/// 注意这里只比对库里的字符串，不代表地址真的在本机；隐私闸门必须用
/// [`is_local_endpoint`] 同时校验 base_url，否则把 source 改成 "local"
/// 就能把「仅本地」作品发到公网。
pub fn is_local(source: &str) -> bool {
    source == SOURCE_LOCAL
}

/// 解析出的服务端点，只保留安全校验需要的 scheme / host / port。
#[derive(Debug, PartialEq, Eq)]
struct Endpoint {
    scheme: String,
    host: String,
    port: u16,
}

/// 解析并校验服务地址，返回可用于比对的 `scheme://host:port` 归一化键。
///
/// 探测与保存都必须先过这一关：只允许 http(s)，拒绝 URL 里的登录信息
/// （否则 `http://trusted@evil.com` 会骗过肉眼检查），并拦掉链路本地地址
/// （云环境的 169.254.169.254 元数据服务就在这个段里）。域名无法离线判定
/// 实际解析结果，凭据回填因此还要额外校验引用归属（见 provider::probe）。
pub fn endpoint_key(base_url: &str) -> Result<String, AppError> {
    let endpoint = parse_endpoint(base_url)?;
    Ok(format!(
        "{}://{}:{}",
        endpoint.scheme, endpoint.host, endpoint.port
    ))
}

/// 校验服务地址是否安全可用；不关心归一化键的调用方用这个入口。
pub fn validate_base_url(base_url: &str) -> Result<(), AppError> {
    parse_endpoint(base_url).map(|_| ())
}

/// 判断 source=local 的地址是否真的指向本机（回环地址）。
///
/// 保存时拒绝 local + 公网地址，运行时也按这个结果做隐私闸门：
/// 老库里可能已经有伪造的 local 配置，不能因为落库时就放过而在发送时再信任一次。
pub fn is_local_endpoint(source: &str, base_url: &str) -> bool {
    if !is_local(source) {
        return false;
    }
    let Ok(endpoint) = parse_endpoint(base_url) else {
        return false;
    };
    if let Ok(ip) = IpAddr::from_str(&endpoint.host) {
        ip.is_loopback()
    } else {
        endpoint.host == "localhost" || endpoint.host == "localhost.localdomain"
    }
}

fn parse_endpoint(base_url: &str) -> Result<Endpoint, AppError> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let (scheme, rest) = trimmed.split_once("://").ok_or_else(|| {
        AppError::validation("服务地址必须是 http 或 https 开头的完整 URL")
    })?;
    if scheme != "http" && scheme != "https" {
        return Err(AppError::validation("服务地址只支持 http 或 https"));
    }
    let authority = rest.split('/').next().unwrap_or("");
    // userinfo（`user:pass@host`）会让地址的肉眼判断与实际请求目标不一致。
    if authority.is_empty() || authority.contains('@') {
        return Err(AppError::validation("服务地址必须指定主机，且不能包含登录信息"));
    }
    let (host, port) = if let Some(inner) = authority.strip_prefix('[') {
        let end = inner.find(']').ok_or_else(|| AppError::validation("IPv6 地址缺少右方括号"))?;
        let host = &inner[..end];
        let tail = &inner[end + 1..];
        let port = match tail.strip_prefix(':') {
            Some(raw) => parse_port(raw)?,
            None => default_port(scheme),
        };
        (host, port)
    } else if let Some((host, raw_port)) = authority.rsplit_once(':') {
        (host, parse_port(raw_port)?)
    } else {
        (authority, default_port(scheme))
    };
    if host.is_empty() {
        return Err(AppError::validation("服务地址缺少主机名"));
    }
    // 链路本地段包含云元数据地址；未指定/组播/保留地址也不可能是合法模型服务。
    if let Ok(ip) = IpAddr::from_str(host) {
        let dangerous = match ip {
            // 169.254/16 含云元数据；0/8、224/4、240/4 分别是未指定、组播与保留段。
            // 标准库的 is_reserved 尚不稳定，这里直接按字节判断。
            IpAddr::V4(v4) => {
                let o = v4.octets();
                (o[0] == 169 && o[1] == 254) || o[0] == 0 || o[0] >= 224
            }
            // IPv6 的 fe80::/10 是链路本地单播，标准库没有对应的便捷方法。
            IpAddr::V6(v6) => {
                v6.is_unspecified() || v6.is_multicast() || (v6.segments()[0] & 0xffc0) == 0xfe80
            }
        };
        if dangerous {
            return Err(AppError::validation("服务地址不能指向链路本地或保留网段"));
        }
    }
    Ok(Endpoint {
        scheme: scheme.to_string(),
        host: host.to_ascii_lowercase(),
        port,
    })
}

fn parse_port(raw: &str) -> Result<u16, AppError> {
    raw.parse::<u16>()
        .map_err(|_| AppError::validation("服务地址的端口号无效"))
}

fn default_port(scheme: &str) -> u16 {
    if scheme == "https" { 443 } else { 80 }
}

/// 对话接口地址。
///
/// OpenAI 兼容协议统一是 `/chat/completions`；Ollama 的 `/v1` 前缀说的也是这套协议，
/// 所以不需要按厂商分支。注意思考型模型在该端点上会把输出全放进 `reasoning` 字段，
/// 这种情况由 [`native_chat_url`] 走原生协议处理。
pub fn chat_url(base_url: &str) -> String {
    format!("{}/chat/completions", trim(base_url))
}

/// Ollama 原生对话地址：把 `/v1` 去掉后拼 `/api/chat`。
/// 原生接口支持 `think: false`，能让思考型模型直接输出正文，而不是把内容塞进 reasoning 字段。
pub fn native_chat_url(base_url: &str) -> String {
    let base = trim(base_url);
    let base = base.strip_suffix("/v1").unwrap_or(base);
    format!("{base}/api/chat")
}

/// 是否应该走 Ollama 原生协议。只识别本地 Provider 的默认端口：
/// 其他本地 OpenAI 兼容服务（llama.cpp 等）仍走通用 SSE 分支，避免误判。
pub fn is_ollama_native(source: &str, base_url: &str) -> bool {
    if !is_local(source) {
        return false;
    }
    let base = trim(base_url);
    base.contains("://localhost:11434") || base.contains("://127.0.0.1:11434")
}

/// embedding 接口地址（同样走 OpenAI 兼容协议）。
pub fn embeddings_url(base_url: &str) -> String {
    format!("{}/embeddings", trim(base_url))
}

/// 探测模型列表时依次尝试的地址。
///
/// Ollama 原生接口是 `/api/tags`，OpenAI 兼容的是 `/models`；
/// `base_url` 已经带 `/v1` 时不再拼 `/v1/models`，避免出现 `/v1/v1/models`。
pub fn model_list_urls(base_url: &str) -> Vec<String> {
    let base = trim(base_url);
    let mut urls = vec![format!("{base}/models")];
    if !base.ends_with("/v1") {
        urls.push(format!("{base}/v1/models"));
    }
    urls.push(format!("{base}/api/tags"));
    urls
}

fn trim(base_url: &str) -> &str {
    base_url.trim().trim_end_matches('/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_and_embeddings_urls_strip_trailing_slash() {
        assert_eq!(
            chat_url("http://localhost:11434/v1/"),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            embeddings_url("http://api.example.com/v1"),
            "http://api.example.com/v1/embeddings"
        );
    }

    #[test]
    fn model_list_skips_duplicate_v1_prefix() {
        let urls = model_list_urls("http://localhost:11434/v1");
        assert_eq!(urls[0], "http://localhost:11434/v1/models");
        assert!(!urls.iter().any(|url| url.contains("/v1/v1/")));
        assert_eq!(urls.last().unwrap(), "http://localhost:11434/v1/api/tags");
    }

    #[test]
    fn local_source_matching_is_exact() {
        assert!(is_local("local"));
        assert!(!is_local("Local"));
        assert!(!is_local("remote"));
    }

    #[test]
    fn native_chat_url_strips_v1_prefix() {
        assert_eq!(
            native_chat_url("http://localhost:11434/v1/"),
            "http://localhost:11434/api/chat"
        );
        assert_eq!(
            native_chat_url("http://localhost:11434"),
            "http://localhost:11434/api/chat"
        );
    }

    #[test]
    fn ollama_native_only_matches_local_default_port() {
        assert!(is_ollama_native("local", "http://localhost:11434/v1"));
        assert!(is_ollama_native("local", "http://127.0.0.1:11434/v1"));
        assert!(!is_ollama_native("remote", "http://localhost:11434/v1"));
        assert!(!is_ollama_native("local", "http://localhost:8080/v1"));
    }

    #[test]
    fn endpoint_key_normalizes_scheme_host_and_port() {
        assert_eq!(
            endpoint_key("https://api.example.com/v1/").unwrap(),
            "https://api.example.com:443"
        );
        assert_eq!(
            endpoint_key("http://127.0.0.1:11434").unwrap(),
            "http://127.0.0.1:11434"
        );
    }

    #[test]
    fn endpoint_rejects_non_http_userinfo_and_metadata_addresses() {
        assert!(endpoint_key("file:///etc/passwd").is_err());
        assert!(endpoint_key("http://user:pass@example.com/v1").is_err());
        // 云元数据藏在链路本地段，探测接口不能成为访问它的通道。
        assert!(endpoint_key("http://169.254.169.254/latest/meta-data").is_err());
        assert!(endpoint_key("http://[fe80::1]/v1").is_err());
        assert!(endpoint_key("http://").is_err());
    }

    #[test]
    fn local_endpoint_requires_loopback_address() {
        assert!(is_local_endpoint("local", "http://localhost:11434/v1"));
        assert!(is_local_endpoint("local", "http://127.0.0.1:11434/v1"));
        assert!(!is_local_endpoint("local", "https://api.example.com/v1"));
        assert!(!is_local_endpoint("remote", "http://127.0.0.1:11434/v1"));
    }
}
