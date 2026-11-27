//! 网关的工具调用兼容性处理：字段名方言、schema 被拒时的降级。
//!
//! 从 gateway.rs 拆出以控制单文件行数。这里只处理纯数据转换，不碰网络与状态。

use crate::models::chat::ChatMessage;

/// OpenAI 兼容接口要 `tool_calls` / `tool_call_id`（snake_case），
/// 而 ChatMessage 的 serde 规则是 camelCase，多轮工具调用直接发会被上游判成类型错误。
/// 这里统一转成标准字段名；arguments 保持 JSON 字符串，符合 OpenAI function calling 协议。
pub fn openai_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|message| {
            let mut value = serde_json::to_value(message).unwrap_or(serde_json::Value::Null);
            let Some(item) = value.as_object_mut() else {
                return value;
            };
            if let Some(calls) = item.remove("toolCalls") {
                item.insert("tool_calls".to_string(), calls);
            }
            if let Some(id) = item.remove("toolCallId") {
                item.insert("tool_call_id".to_string(), id);
            }
            value
        })
        .collect()
}

/// 原生 Ollama 接口把 arguments 放在 message.tool_calls 里且已是对象；
/// camelCase 字段名是它自己的方言，这里只把字符串 arguments 还原成对象。
pub fn native_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|message| {
            let mut value = serde_json::to_value(message).unwrap_or(serde_json::Value::Null);
            let Some(calls) = value.get_mut("toolCalls").and_then(|item| item.as_array_mut()) else {
                return value;
            };
            for call in calls {
                let Some(args) = call.pointer_mut("/function/arguments") else {
                    continue;
                };
                if let Some(text) = args.as_str() {
                    *args = serde_json::from_str(text).unwrap_or_else(|_| serde_json::json!({}));
                }
            }
            value
        })
        .collect()
}

/// 去掉请求里所有工具相关结构，供「模型拒绝 tools schema」时降级重试。
///
/// 只删 `tools` 不够：上一轮回填的 assistant.toolCalls 与 tool 角色消息同样带
/// function 结构，模型若连 schema 都不认，这些字段会让它继续 400。把 tool 消息
/// 压成普通文本，保留工具执行结果的信息，模型仍能基于结果作答。
pub fn strip_tooling(body: &mut serde_json::Value) {
    let Some(map) = body.as_object_mut() else {
        return;
    };
    map.remove("tools");
    map.remove("tool_choice");
    let Some(messages) = map.get_mut("messages").and_then(serde_json::Value::as_array_mut) else {
        return;
    };
    for message in messages.iter_mut() {
        let Some(item) = message.as_object_mut() else {
            continue;
        };
        item.remove("toolCalls");
        item.remove("tool_calls");
        item.remove("tool_call_id");
        item.remove("toolCallId");
        // tool 角色的内容本身就是工具回执文本，改成 user 消息让模型接着读。
        if item.get("role").and_then(serde_json::Value::as_str) == Some("tool") {
            item.insert("role".into(), serde_json::json!("user"));
        }
    }
}

/// 判断上游错误体是否在抱怨 tools/function schema。
/// 只认工具相关关键词，避免把无关的 400（如 temperature 非法）误判成工具不兼容。
pub fn mentions_tool_schema(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("tool_choice")
        || lower.contains("tools.")
        || lower.contains("tool_call_id")
        || lower.contains("toolcallid")
        || lower.contains("tool_calls")
        || (lower.contains("tool") && lower.contains("function"))
        || lower.contains("function_call")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 只有明确抱怨工具 schema 的 400 才触发降级，其它参数错误照常报错。
    #[test]
    fn mentions_tool_schema_only_matches_tool_errors() {
        assert!(mentions_tool_schema(
            r#"{"error":{"code":400,"message":"Param `tools.0.function.parameters` is not valid type"}}"#
        ));
        assert!(mentions_tool_schema("Invalid tool_choice value"));
        assert!(mentions_tool_schema("function_call schema mismatch"));
        assert!(mentions_tool_schema("Param `tool_call_id` is not valid type"));
        assert!(!mentions_tool_schema("invalid api key"));
        assert!(!mentions_tool_schema("temperature out of range"));
    }

    /// OpenAI 兼容接口要 snake_case；camelCase 的 toolCallId 会被判成类型错误。
    #[test]
    fn openai_messages_use_snake_case_tool_fields() {
        let messages = vec![
            ChatMessage {
                role: "assistant".into(),
                content: String::new(),
                tool_call_id: None,
                name: None,
                tool_calls: Some(serde_json::json!([{
                    "id": "call_1",
                    "type": "function",
                    "function": { "name": "read_chapter", "arguments": "{}" }
                }])),
            },
            ChatMessage {
                role: "tool".into(),
                content: "正文".into(),
                tool_call_id: Some("call_1".into()),
                name: Some("read_chapter".into()),
                tool_calls: None,
            },
        ];
        let converted = openai_messages(&messages);
        assert!(converted[0].get("tool_calls").is_some());
        assert!(converted[0].get("toolCalls").is_none());
        assert_eq!(converted[1]["tool_call_id"], serde_json::json!("call_1"));
        assert!(converted[1].get("toolCallId").is_none());
    }

    /// 降级时必须把多轮回填的 function 结构一起清掉，否则同一个模型接着报 400。
    #[test]
    fn strip_tooling_removes_all_function_structures() {
        let mut body = serde_json::json!({
            "model": "mimo-v2.6-flash",
            "tools": [{ "type": "function", "function": { "name": "get_project" } }],
            "tool_choice": "required",
            "messages": [
                { "role": "system", "content": "先调工具" },
                { "role": "assistant", "content": "", "toolCalls": [{ "function": { "name": "get_project" } }] },
                { "role": "tool", "content": "作品信息", "toolCallId": "call_1", "name": "get_project" }
            ]
        });
        strip_tooling(&mut body);
        assert!(body.get("tools").is_none());
        assert!(body.get("tool_choice").is_none());
        assert!(body["messages"][1].get("toolCalls").is_none());
        assert_eq!(body["messages"][2]["role"], serde_json::json!("user"));
        assert!(body["messages"][2].get("toolCallId").is_none());
        assert_eq!(body["messages"][2]["content"], serde_json::json!("作品信息"));
    }

    /// 原生接口要的是 arguments 对象；字符串原样发过去会被 400 拒掉，多轮工具调用根本走不完。
    #[test]
    fn native_messages_turn_tool_arguments_into_objects() {
        let messages = vec![
            ChatMessage {
                role: "assistant".to_string(),
                content: String::new(),
                tool_call_id: None,
                name: None,
                tool_calls: Some(serde_json::json!([{
                    "id": "call_1",
                    "type": "function",
                    "function": { "name": "read_chapter", "arguments": "{\"withContent\":true}" }
                }])),
            },
            ChatMessage {
                role: "tool".to_string(),
                content: "{\"title\":\"第一章\"}".to_string(),
                tool_call_id: Some("call_1".to_string()),
                name: Some("read_chapter".to_string()),
                tool_calls: None,
            },
        ];
        let converted = native_messages(&messages);
        assert_eq!(
            converted[0].pointer("/toolCalls/0/function/arguments"),
            Some(&serde_json::json!({ "withContent": true }))
        );
        assert_eq!(converted[1]["role"], serde_json::json!("tool"));
        assert_eq!(converted[1]["name"], serde_json::json!("read_chapter"));
    }

    /// 参数是被截断或乱码时不能把整轮请求打成 400，退化成空对象让对话继续。
    #[test]
    fn native_messages_fall_back_to_empty_object_on_bad_arguments() {
        let messages = vec![ChatMessage {
            role: "assistant".to_string(),
            content: String::new(),
            tool_call_id: None,
            name: None,
            tool_calls: Some(serde_json::json!([{
                "function": { "name": "read_chapter", "arguments": "{\"withContent\":" }
            }])),
        }];
        let converted = native_messages(&messages);
        assert_eq!(
            converted[0].pointer("/toolCalls/0/function/arguments"),
            Some(&serde_json::json!({}))
        );
    }
}
