//! MCP 协议的纯数据构造与解析，不碰进程与 IO，便于单测。
//!
//! 采用「每次调用 spawn 一个进程」的短连接模式：MCP 的 stdio server 每次启动后
//! 完成 initialize 握手，就能回答 tools/list 或 tools/call，然后随 stdin 关闭退出。
//! 相比维护长驻进程的 pending 请求表与崩溃重启，短连接对写作场景足够且几乎没有生命周期风险。

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::AppError;

/// MCP server 配置，序列化成一个 JSON 数组存 app_meta。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    /// 界面显示名。
    pub name: String,
    /// 启动命令（如 npx、uvx 或绝对路径）。
    pub command: String,
    /// 命令行参数。
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

/// 从 MCP tools/list 响应里解析出的工具描述，供前端转成 OpenAI function schema。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub server_id: String,
    pub name: String,
    pub description: String,
    /// JSON Schema 对象（MCP 的 inputSchema 就是标准 JSON Schema）。
    pub input_schema: Value,
    /// 应用自带的默认工具（如联网搜索）：可信、只读，前端不需要审批闸门。
    #[serde(default)]
    pub builtin: bool,
}

/// 构造 initialize 请求。protocolVersion 用 MCP 2024-11-05，主流 server 都兼容。
pub fn initialize_request(id: u64) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "ink-harness", "version": "0.1.0" }
        }
    })
}

/// initialized 通知：握手完成后的单向通知，没有 id，server 不回包。
pub fn initialized_notification() -> Value {
    json!({ "jsonrpc": "2.0", "method": "notifications/initialized", "params": {} })
}

/// tools/list 请求。
pub fn list_tools_request(id: u64) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": "tools/list", "params": {} })
}

/// tools/call 请求。arguments 必须是对象。
pub fn call_tool_request(id: u64, name: &str, arguments: &Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "tools/call",
        "params": { "name": name, "arguments": arguments }
    })
}

/// 从一行 JSON-RPC 响应里取出指定 id 的 result；非响应行（日志/通知）返回 None。
pub fn result_for_id(line: &str, id: u64) -> Result<Option<Value>, AppError> {
    let value: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        // MCP server 偶尔往 stdout 打非 JSON 日志，跳过而不是整次调用失败。
        Err(_) => return Ok(None),
    };
    if value.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Ok(None);
    }
    match value.get("id").and_then(Value::as_u64) {
        Some(actual) if actual == id => {
            if let Some(error) = value.get("error") {
                let message = error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("MCP 返回错误");
                return Err(AppError::upstream(format!("MCP 错误：{message}")));
            }
            Ok(value.get("result").cloned())
        }
        _ => Ok(None),
    }
}

/// 解析 tools/list 的 result 为工具清单；字段缺失时跳过该工具而非整批失败。
pub fn parse_tool_list(server_id: &str, result: &Value) -> Vec<McpToolInfo> {
    let Some(tools) = result.get("tools").and_then(Value::as_array) else {
        return Vec::new();
    };
    tools
        .iter()
        .filter_map(|tool| {
            let name = tool.get("name")?.as_str()?.to_string();
            if name.is_empty() {
                return None;
            }
            Some(McpToolInfo {
                server_id: server_id.to_string(),
                name,
                description: tool
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                input_schema: tool
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                // tools/list 来自第三方进程，不能让它自称内置工具来绕过审批。
                builtin: false,
            })
        })
        .collect()
}

/// 把 tools/call 的 result 压成一段文本：优先取 text 内容项，其余 JSON 兜底。
pub fn tool_result_text(result: &Value) -> String {
    if let Some(content) = result.get("content").and_then(Value::as_array) {
        let parts: Vec<String> = content
            .iter()
            .filter_map(|item| {
                if item.get("type").and_then(Value::as_str) == Some("text") {
                    item.get("text").and_then(Value::as_str).map(str::to_string)
                } else {
                    None
                }
            })
            .collect();
        if !parts.is_empty() {
            return parts.join("\n");
        }
    }
    result.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_use_jsonrpc_2_and_unique_ids() {
        let init = initialize_request(1);
        assert_eq!(init["jsonrpc"], "2.0");
        assert_eq!(init["method"], "initialize");
        assert_eq!(init["id"], 1);
        assert_eq!(list_tools_request(2)["method"], "tools/list");
        let call = call_tool_request(3, "read_file", &json!({ "path": "a.md" }));
        assert_eq!(call["method"], "tools/call");
        assert_eq!(call["params"]["name"], "read_file");
        assert_eq!(call["params"]["arguments"]["path"], "a.md");
    }

    #[test]
    fn initialized_is_a_notification_without_id() {
        let notice = initialized_notification();
        assert_eq!(notice["method"], "notifications/initialized");
        assert!(notice.get("id").is_none());
    }

    #[test]
    fn result_for_id_ignores_logs_and_other_ids() {
        assert_eq!(result_for_id("a plain log line", 1).unwrap(), None);
        assert_eq!(result_for_id(r#"{"jsonrpc":"2.0","id":9,"result":{}}"#, 1).unwrap(), None);
        assert!(result_for_id(r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#, 1)
            .unwrap()
            .is_some());
    }

    #[test]
    fn result_for_id_surfaces_upstream_errors() {
        let line = r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"未知方法"}}"#;
        let err = result_for_id(line, 1).unwrap_err();
        assert_eq!(err.code(), "upstream");
        assert!(err.message.contains("未知方法"));
    }

    #[test]
    fn parses_tool_list_and_skips_broken_entries() {
        let result = json!({
            "tools": [
                { "name": "read_file", "description": "读文件", "inputSchema": { "type": "object" } },
                { "description": "没有名字，应跳过" }
            ]
        });
        let tools = parse_tool_list("srv1", &result);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].server_id, "srv1");
        assert_eq!(tools[0].name, "read_file");
        assert_eq!(tools[0].input_schema["type"], "object");
    }

    #[test]
    fn tool_result_text_prefers_text_items() {
        let result = json!({
            "content": [
                { "type": "text", "text": "第一行" },
                { "type": "image", "data": "..." },
                { "type": "text", "text": "第二行" }
            ]
        });
        assert_eq!(tool_result_text(&result), "第一行\n第二行");
        assert_eq!(tool_result_text(&json!({"other": 1})), r#"{"other":1}"#);
    }
}
