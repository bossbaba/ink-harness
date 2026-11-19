//! 纯逻辑模块的边界 / UB 回归测试。
//!
//! 这些用例只在 ub-check（Miri + ASan）里跑，针对的是最容易出问题的边界：
//! 多字节字符切分、任意分片点、超范围整数、空输入。它们调用主 crate 的 pub API，
//! 源码通过 #[path] 共享，因此被测逻辑与主 crate 完全一致。
//!
//! 说明：这些模块都是 safe Rust，Miri 在这里的价值是验证各条边界路径不 panic、
//! 标准库（迭代器 / String / serde_json）交互正确；ASan 作为兜底，覆盖标准库内部的内存问题。

use ub_check::{gateway_sse, provider_kind, rag_chunk};

// ---------- 文本切分：多字节与边界 ----------

/// 中文按 char 硬切，不能切断码点，也不能在 trim 时丢字符。
/// Miri 会盯住 Vec<char> -> String 的收集过程，ASan 兜底检查缓冲区。
#[test]
fn hard_split_multibyte_chars_are_never_torn() {
    let original = "汉".repeat(700 * 2 + 13);
    let chunks = rag_chunk::split_chunks(&original);
    assert_eq!(chunks.len(), 3, "超过两个硬上限应切成三段");
    assert!(chunks.iter().all(|c| c.chars().count() <= 700));
    // 纯汉字无空白，trim 不应吞掉任何字符，拼回去必须等于原文。
    assert_eq!(chunks.concat(), original);
}

/// emoji 是 4 字节字符，验证按 char（而非按 byte）切分。
#[test]
fn hard_split_emoji_survives_chunk_boundary() {
    let original = "😀".repeat(700 + 5);
    let chunks = rag_chunk::split_chunks(&original);
    assert_eq!(chunks.len(), 2);
    assert_eq!(chunks.concat(), original);
}

/// 恰好等于硬上限时不应多切出一段。
#[test]
fn split_chunks_at_exact_limit_stays_single() {
    let text = "字".repeat(700);
    let chunks = rag_chunk::split_chunks(&text);
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].chars().count(), 700);
}

/// 空串与纯空白必须安全返回空列表，不能产生空片段。
#[test]
fn split_chunks_empty_and_whitespace_only() {
    assert!(rag_chunk::split_chunks("").is_empty());
    assert!(rag_chunk::split_chunks("\n\n").is_empty());
    assert!(rag_chunk::split_chunks("   \t  ").is_empty());
}

/// detail_json 非法时摊平逻辑要兜底成空对象，不 panic。
#[test]
fn element_text_tolerates_broken_detail_json() {
    let text = rag_chunk::element_text("place", "西湖", "杭州", "{bad json");
    assert_eq!(text, "地点：西湖\n简介：杭州");
}

// ---------- Provider 方言：字符串边界 ----------

/// 空 URL 与纯斜杠不能让 URL 拼接 panic，结果应稳定可预期。
#[test]
fn provider_urls_handle_empty_and_slash_only() {
    assert_eq!(provider_kind::chat_url(""), "/chat/completions");
    assert_eq!(provider_kind::embeddings_url("///"), "/embeddings");
    assert_eq!(
        provider_kind::native_chat_url("http://localhost:11434/v1"),
        "http://localhost:11434/api/chat"
    );
}

/// 超长且含连续斜杠的 base_url 不应触发截断或越界。
#[test]
fn provider_urls_handle_long_and_repeated_slashes() {
    let base = format!("{}/v1/", "http://example.com/".repeat(100));
    let url = provider_kind::chat_url(&base);
    assert!(url.ends_with("/chat/completions"));
    assert!(!provider_kind::model_list_urls(&base).is_empty());
}

// ---------- SSE 解析：任意分片点与畸形输入 ----------

/// 把一个完整 SSE 事件逐字节喂入解析器：每个字节都是潜在的分片点，
/// 验证缓冲逻辑在任意切分下都不丢事件、不 panic。
/// 用纯 ASCII 正文，避免多字节字符按 byte 喂入时被截断成非法 UTF-8。
#[test]
fn sse_parser_accepts_byte_by_byte_feeding() {
    let raw = "data: {\"choices\":[{\"delta\":{\"content\":\"byte-wise\"}}]}\n\n";
    let mut parser = gateway_sse::SseParser::new();
    let mut decoded = String::new();
    for byte in raw.bytes() {
        for event in parser.push(&(byte as char).to_string()) {
            if let gateway_sse::SseEvent::Delta(text) = event {
                decoded.push_str(&text);
            }
        }
    }
    assert_eq!(decoded, "byte-wise", "逐字节喂完应还原出完整正文");
}

/// tool_call 的 index 字段给负数 / 超大值 / 字符串时不 panic，
/// 解析器应走「无法解析当作 0」的兜底路径。
#[test]
fn sse_parser_tolerates_malformed_tool_index() {
    for index in ["-1", "18446744073709551616", "\"not-a-number\""] {
        let frame = format!(
            "data: {{\"choices\":[{{\"delta\":{{\"tool_calls\":[{{\"index\":{index},\"function\":{{\"name\":\"f\",\"arguments\":\"{{}}\"}}}}]}}}}]}}\n\n"
        );
        let mut parser = gateway_sse::SseParser::new();
        let events = parser.push(&frame);
        assert_eq!(events.len(), 1, "index 畸形也应产出工具调用事件");
        assert!(matches!(events[0], gateway_sse::SseEvent::ToolCall(_)));
    }
}

/// 超大 token 计数超出 u32 时必须被丢弃（计 0），不能因 `as` 截断或加法溢出。
#[test]
fn sse_usage_overflow_does_not_wrap() {
    let mut parser = gateway_sse::SseParser::new();
    let events = parser.push(
        "data: {\"usage\":{\"prompt_tokens\":18446744073709551615,\"completion_tokens\":18446744073709551615}}\n\n",
    );
    assert!(events.is_empty(), "两个计数都超范围应视为没有用量");
}

/// 纯 garbage 字节流不应让解析器越界或产生事件。
#[test]
fn sse_parser_ignores_garbage() {
    let mut parser = gateway_sse::SseParser::new();
    assert!(parser.push("\u{fffd}\u{0}\n\nnot json\n\n").is_empty());
}
