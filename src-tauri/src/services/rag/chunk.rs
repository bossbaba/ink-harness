//! 检索前的文本处理：把 TipTap 文档 JSON 变成纯文本，再切成适合检索的片段。
//!
//! 分段策略决定了检索质量：段太小会碎片化、命中后拼不出语境；
//! 段太大则一条就吃掉大半个提示词预算，所以按「目标字数 + 硬上限」两级控制。

/// 单段目标字数：短段落会按顺序合并到这个量级。
const CHUNK_TARGET: usize = 400;
/// 单段硬上限：没有空行的超长段落必须硬切。
const CHUNK_MAX: usize = 700;

/// 从 TipTap 文档 JSON 里抽纯文本。
///
/// 只认 `text` 字段与块级节点换行，不渲染 HTML：检索注入的是提示词，
/// 格式标记只会浪费 token。非法 JSON 返回空串，不让一处坏数据毁掉整次索引。
pub fn extract_text(raw: &str) -> String {
    let value: serde_json::Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(_) => return String::new(),
    };

    let mut out = String::new();
    walk(&value, &mut out);
    out.trim().to_string()
}

fn walk(node: &serde_json::Value, out: &mut String) {
    if let Some(text) = node.get("text").and_then(|t| t.as_str()) {
        out.push_str(text);
    }
    if let Some(children) = node.get("content").and_then(|c| c.as_array()) {
        for child in children {
            walk(child, out);
        }
    }
    // 块级节点之间补换行，后续分段才有边界可用。
    let is_block = matches!(
        node.get("type").and_then(|t| t.as_str()),
        Some("paragraph" | "heading" | "listItem" | "blockquote")
    );
    if is_block && !out.ends_with('\n') {
        out.push('\n');
    }
}

/// 按段落切分并合并：短段拼到接近目标字数，超长段硬切。
pub fn split_chunks(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for line in text.split('\n') {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.chars().count() > CHUNK_MAX {
            flush(&mut current, &mut chunks);
            chunks.extend(hard_split(line));
            continue;
        }
        if chars(&current) + chars(line) > CHUNK_TARGET && !current.is_empty() {
            flush(&mut current, &mut chunks);
        }
        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(line);
    }
    flush(&mut current, &mut chunks);
    chunks
}

fn chars(text: &str) -> usize {
    text.chars().count()
}

fn flush(current: &mut String, chunks: &mut Vec<String>) {
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        chunks.push(trimmed.to_string());
    }
    current.clear();
}

fn hard_split(line: &str) -> Vec<String> {
    line.chars()
        .collect::<Vec<char>>()
        .chunks(CHUNK_MAX)
        .map(|piece| piece.iter().collect::<String>().trim().to_string())
        .filter(|piece| !piece.is_empty())
        .collect()
}

/// 把一条设定摊平成可检索文本：名字与类型在最前，后面跟简介、别名、时间、备注。
pub fn element_text(kind: &str, name: &str, summary: &str, detail_json: &str) -> String {
    let kind_label = match kind {
        "character" => "人物",
        "place" => "地点",
        "org" => "组织",
        "event" => "时间线",
        "term" => "术语",
        _ => "设定",
    };
    let detail: serde_json::Value = serde_json::from_str(detail_json).unwrap_or_default();

    let mut lines = vec![format!("{kind_label}：{name}")];
    if !summary.trim().is_empty() {
        lines.push(format!("简介：{}", summary.trim()));
    }
    if let Some(aliases) = detail.get("aliases").and_then(|a| a.as_array()) {
        let names: Vec<&str> = aliases.iter().filter_map(|a| a.as_str()).collect();
        if !names.is_empty() {
            lines.push(format!("别名：{}", names.join("、")));
        }
    }
    let time_start = detail.get("timeStart").and_then(|t| t.as_str());
    let time_end = detail.get("timeEnd").and_then(|t| t.as_str());
    if time_start.is_some() || time_end.is_some() {
        lines.push(format!(
            "时间：{} ~ {}",
            time_start.unwrap_or("?"),
            time_end.unwrap_or("?")
        ));
    }
    if let Some(notes) = detail.get("notes").and_then(|n| n.as_str()) {
        if !notes.trim().is_empty() {
            lines.push(format!("备注：{}", notes.trim()));
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 段落之间要有换行，否则分段会把整章挤成一段。
    #[test]
    fn extract_text_reads_paragraphs() {
        let doc = serde_json::json!({
            "type": "doc",
            "content": [
                { "type": "paragraph", "content": [{ "type": "text", "text": "第一段" }] },
                { "type": "paragraph", "content": [{ "type": "text", "text": "第二段" }] }
            ]
        });
        assert_eq!(extract_text(&doc.to_string()), "第一段\n第二段");
    }

    #[test]
    fn extract_text_tolerates_broken_json() {
        assert_eq!(extract_text("{not json"), "");
        assert_eq!(extract_text(""), "");
    }

    /// 短段合并到目标字数附近，避免一条设定被拆成很多碎片。
    #[test]
    fn split_chunks_merges_short_paragraphs() {
        let text = "第一段内容。\n第二段内容。\n第三段内容。";
        let chunks = split_chunks(text);
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].contains("第三段"));
    }

    /// 超长单段必须硬切，否则一条片段就能吃掉整个上下文预算。
    #[test]
    fn split_chunks_hard_splits_long_paragraph() {
        let text = "字".repeat(CHUNK_MAX + 50);
        let chunks = split_chunks(&text);
        assert_eq!(chunks.len(), 2);
        assert!(chunks.iter().all(|c| c.chars().count() <= CHUNK_MAX));
    }

    #[test]
    fn split_chunks_ignores_blank_text() {
        assert!(split_chunks("  \n\n \n").is_empty());
    }

    #[test]
    fn element_text_includes_alias_and_time() {
        let detail = serde_json::json!({
            "aliases": ["小墨"],
            "timeStart": "2024-03",
            "timeEnd": "2024-09",
            "notes": "主角"
        });
        let text = element_text("character", "墨白", "少年剑客", &detail.to_string());
        assert!(text.starts_with("人物：墨白"));
        assert!(text.contains("别名：小墨"));
        assert!(text.contains("时间：2024-03 ~ 2024-09"));
        assert!(text.contains("备注：主角"));
    }
}
