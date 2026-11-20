//! Guardrails：模型输出与工具结果的脱敏过滤。
//!
//! 模型可能因为提示词注入、上下文误带而把 API Key、私钥、访问令牌原样吐出来，
//! 这些内容一旦落到界面、聊天气泡或审计日志，就等于把凭据写进了明文。
//!
//! 这里刻意只拦「凭据类」特征，不做手机号/身份证/邮箱等 PII 过滤：
//! 本项目是小说写作工具，正文里出现手机号、身份证、邮箱是正常情节，
//! 过度过滤会把作者写的东西改坏。凭据形态（sk-、AKIA、ghp_、PEM 私钥头）
//! 在小说里几乎不会自然出现，误伤概率低。

/// 脱敏后统一展示的占位文本；保留「为何被替换」的信息，作者能自己判断。
pub const MASK: &str = "[已屏蔽:疑似凭据]";

/// 逐块脱敏：用于流式输出的每一段 delta。
///
/// 已知局限：凭据被切在两个 chunk 的边界上时单块都匹配不到。
/// 流式场景无法等全文再发（会失去逐字体验），只能接受这一取舍；
/// 落库的审计文本走 [`scrub`] 对完整输出再过一遍，补上边界漏网。
pub fn scrub_chunk(text: &str) -> String {
    scrub(text)
}

/// 对完整文本做脱敏，返回替换后的字符串。
/// 命中规则按「越具体越先替换」排序，避免短规则把长凭据切碎后剩下半截。
pub fn scrub(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let mut out = text.to_string();
    for (prefix, min_len) in TOKEN_PREFIXES {
        out = mask_prefixed(&out, prefix, *min_len);
    }
    out = mask_bearer(&out);
    out = mask_pem(&out);
    out
}

/// 常见凭据前缀与「前缀之后至少多少个合法字符」。
/// 长度下限用来避免把正文里的 `sk-` 前缀词（极少见）误判成凭据。
const TOKEN_PREFIXES: &[(&str, usize)] = &[
    ("sk-", 16),
    ("sk-ant-", 16),
    ("ghp_", 20),
    ("gho_", 20),
    ("github_pat_", 20),
    ("xoxb-", 10),
    ("AKIA", 12),
    ("AIza", 20),
];

/// 匹配 `prefix + 一段 base64/字母数字` 的凭据并整体替换。
fn mask_prefixed(text: &str, prefix: &str, min_len: usize) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(prefix) {
        out.push_str(&rest[..at]);
        let after = &rest[at + prefix.len()..];
        // 凭据主体只含字母数字、下划线、连字符，遇到空格/标点即认为结束。
        let body: String = after
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        if body.len() >= min_len {
            out.push_str(MASK);
            rest = &after[body.len()..];
        } else {
            // 长度不够，按普通文本保留前缀，继续往后找下一个候选。
            out.push_str(prefix);
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

/// 脱敏 `Authorization: Bearer xxx` 与裸 `Bearer xxx` 里的令牌。
fn mask_bearer(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("Bearer ") {
        out.push_str(&rest[..at + "Bearer ".len()]);
        let after = &rest[at + "Bearer ".len()..];
        let token: String = after
            .chars()
            .take_while(|c| !c.is_whitespace() && *c != '"' && *c != '\'')
            .collect();
        // 少于 12 个字符的多半是正文里的英文单词，不当凭据处理。
        if token.len() >= 12 {
            out.push_str(MASK);
            rest = &after[token.len()..];
        } else {
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

/// 脱敏 PEM 私钥块（模型有时会把整个私钥贴出来）；只保留首行标记。
fn mask_pem(text: &str) -> String {
    const BEGIN: &str = "-----BEGIN";
    const END: &str = "-----END";
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(BEGIN) {
        out.push_str(&rest[..at]);
        // 找配对的 END：找不到就把剩余全部屏蔽，宁可多屏蔽也不漏私钥。
        let tail = &rest[at..];
        match tail.find(END) {
            Some(end_at) => {
                // 从 END 之后找这一行结尾，整块（含尾随的 -----）一起替换。
                let after_end = &tail[end_at..];
                let line_end = after_end.find('\n').unwrap_or(after_end.len());
                out.push_str(MASK);
                rest = &tail[end_at + line_end..];
            }
            None => {
                out.push_str(MASK);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_normal_prose() {
        let text = "他打开抽屉，里面只有一张写着 13800138000 的便签。";
        assert_eq!(scrub(text), text);
    }

    #[test]
    fn masks_openai_and_github_tokens() {
        let text = "配置是 sk-abcdefghijklmnop123456 和 ghp_abcdefghijklmnopqrstuvwxyz0123";
        let masked = scrub(text);
        assert!(!masked.contains("sk-abcdefghijklmnop123456"));
        assert!(!masked.contains("ghp_abcdefghijklmnopqrstuvwxyz0123"));
        assert_eq!(masked.matches(MASK).count(), 2);
    }

    #[test]
    fn masks_bearer_and_pem() {
        let text = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----";
        let masked = scrub(text);
        assert!(!masked.contains("abcdefghijklmnopqrstuvwxyz"));
        assert!(!masked.contains("MIIE"));
        // PEM 块整体替换，但首行前后的普通文本保留。
        assert!(masked.contains("Authorization: Bearer"));
    }

    #[test]
    fn short_prefix_is_not_masked() {
        // 正文里出现「sk-」但后面不足凭据长度，不应误伤。
        let text = "文件名是 sk-note.md";
        assert_eq!(scrub(text), text);
    }
}
