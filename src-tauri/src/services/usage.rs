//! 调用用量：流式对话结束后把 token 数写进 agent_run，并给看板提供聚合结果。
use crate::error::AppError;
use crate::infrastructure::{db::DbState, id::gen_id};
use crate::models::{ChatParams, ModelUsage, TaskUsage, TokenUsage, UsageStats};
use rusqlite::params;

/// 输入/输出摘要的落库长度：审计只需看清「问了什么、答了什么」，
/// 全文留在会话表里，这里截断避免一行日志塞进整本书。
const SUMMARY_LIMIT: usize = 500;

/// 按字符截断（不是字节），避免截在 UTF-8 多字节中间导致乱码。
fn clip(text: &str, limit: usize) -> &str {
    let trimmed = text.trim();
    let end = trimmed.char_indices().nth(limit).map(|(i, _)| i).unwrap_or(trimmed.len());
    &trimmed[..end]
}

/// 从消息列表里取最后一条用户消息作为输入摘要；找不到就取最后一条。
fn input_summary(params: &ChatParams) -> String {
    let last_user = params
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .or_else(|| params.messages.last());
    last_user
        .map(|m| clip(&m.content, SUMMARY_LIMIT).to_string())
        .unwrap_or_default()
}

/// 写一条调用记录。没有作品 ID 时不写：agent_run.project_id 是外键，
/// 全局设置这类请求也不该混进某部作品的用量看板。
/// input_summary / output 写截断后的真实内容，供审计与成本回放。
pub fn record(
    state: &DbState,
    params: &ChatParams,
    usage: &TokenUsage,
    output: &str,
) -> Result<(), AppError> {
    let Some(project_id) = params.project_id.as_deref().filter(|id| !id.is_empty()) else {
        return Ok(());
    };
    let task_kind = params
        .task_kind
        .as_deref()
        .filter(|kind| !kind.is_empty())
        .unwrap_or("unknown");
    let conn = state.biz();
    conn.execute(
        "insert into agent_run (id, project_id, task_kind, model, input_summary, output, tokens, prompt_tokens, completion_tokens, created_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![
            gen_id("run"),
            project_id,
            task_kind,
            params.model,
            input_summary(params),
            clip(output, SUMMARY_LIMIT),
            usage.total_tokens as i64,
            usage.prompt_tokens as i64,
            usage.completion_tokens as i64,
        ],
    )
    .map_err(AppError::from)?;
    Ok(())
}

/// 聚合全部记录。成本留在前端按模型配置里的单价估算：
/// 单价是配置项，改价后不该回头改写历史消耗。
pub fn stats(state: &DbState) -> Result<UsageStats, AppError> {
    let conn = state.biz();
    let (calls, total, prompt, completion) = conn.query_row(
        "select count(*), coalesce(sum(tokens),0), coalesce(sum(prompt_tokens),0), coalesce(sum(completion_tokens),0) from agent_run",
        [],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        },
    ).map_err(AppError::from)?;

    let mut stmt = conn.prepare(
        "select task_kind, count(*), coalesce(sum(tokens),0) from agent_run group by task_kind order by sum(tokens) desc",
    ).map_err(AppError::from)?;
    let by_task = stmt
        .query_map([], |row| {
            Ok(TaskUsage {
                task_kind: row.get(0)?,
                calls: row.get(1)?,
                tokens: row.get(2)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    let mut stmt = conn.prepare(
        "select model, count(*), coalesce(sum(tokens),0) from agent_run group by model order by sum(tokens) desc",
    ).map_err(AppError::from)?;
    let by_model = stmt
        .query_map([], |row| {
            Ok(ModelUsage {
                model: row.get(0)?,
                calls: row.get(1)?,
                tokens: row.get(2)?,
            })
        })
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;

    Ok(UsageStats {
        calls,
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
        by_task,
        by_model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db;
    // ChatMessage 没有被 models 顶层再导出（它只在这里的测试用到，再导出会触发 unused 警告），
    // 所以按模块全路径引入，与 gateway.rs 的测试保持一致。
    use crate::models::chat::ChatMessage;

    fn temp_state(tag: &str) -> (DbState, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("ih-usage-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = db::open(&dir).unwrap();
        state
            .biz()
            .execute(
                "insert into project (id, title, created_at, updated_at)
                 values ('p1','甲',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                [],
            )
            .unwrap();
        (state, dir)
    }

    fn params(model: &str, task: Option<&str>, project: Option<&str>) -> ChatParams {
        ChatParams {
            model: model.to_string(),
            messages: vec![ChatMessage {
                role: "user".to_string(),
                content: "hi".to_string(),
                tool_call_id: None,
                name: None,
                tool_calls: None,
            }],
            temperature: None,
            max_tokens: None,
            privacy_local_only: false,
            task_kind: task.map(|s| s.to_string()),
            project_id: project.map(|s| s.to_string()),
            tools: Vec::new(),
            tool_choice: None,
            request_id: None,
        }
    }

    fn usage(prompt: u32, completion: u32) -> TokenUsage {
        TokenUsage {
            prompt_tokens: prompt,
            completion_tokens: completion,
            total_tokens: prompt + completion,
        }
    }

    #[test]
    fn no_runs_returns_zero_stats() {
        let (state, dir) = temp_state("empty");
        let result = stats(&state).unwrap();
        assert_eq!(result.calls, 0);
        assert_eq!(result.total_tokens, 0);
        assert!(result.by_task.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn record_writes_real_input_and_output() {
        let (state, dir) = temp_state("io");
        let mut p = params("m", Some("copilot"), Some("p1"));
        p.messages[0].content = "帮我检查第三章".to_string();
        record(&state, &p, &usage(10, 5), "建议改三处").unwrap();
        let conn = state.biz();
        let (input, output): (String, String) = conn
            .query_row(
                "select input_summary, output from agent_run limit 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(input, "帮我检查第三章");
        assert_eq!(output, "建议改三处");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn record_accumulates_tokens_and_calls() {
        let (state, dir) = temp_state("accumulate");
        record(&state, &params("m", Some("continue"), Some("p1")), &usage(10, 5), "测试输出").unwrap();
        record(&state, &params("m", Some("continue"), Some("p1")), &usage(20, 7), "测试输出").unwrap();
        let result = stats(&state).unwrap();
        assert_eq!(result.calls, 2);
        assert_eq!(result.total_tokens, 42);
        assert_eq!(result.prompt_tokens, 30);
        assert_eq!(result.completion_tokens, 12);
        let task = result.by_task.iter().find(|item| item.task_kind == "continue").expect("应有 continue 分组");
        assert_eq!(task.calls, 2);
        assert_eq!(task.tokens, 42);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn record_groups_by_task_kind() {
        let (state, dir) = temp_state("group");
        record(&state, &params("m", Some("continue"), Some("p1")), &usage(10, 0), "测试输出").unwrap();
        record(&state, &params("m", Some("polish"), Some("p1")), &usage(5, 0), "测试输出").unwrap();
        record(&state, &params("m", None, Some("p1")), &usage(3, 0), "测试输出").unwrap();
        let result = stats(&state).unwrap();
        assert_eq!(result.by_task.len(), 3);
        assert_eq!(result.by_task.iter().find(|i| i.task_kind == "unknown").unwrap().tokens, 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn record_without_project_is_skipped() {
        // 没有作品 ID 的请求（如全局设置）不该混进用量看板。
        let (state, dir) = temp_state("no-project");
        record(&state, &params("m", None, None), &usage(10, 5), "测试输出").unwrap();
        record(&state, &params("m", None, Some("")), &usage(10, 5), "测试输出").unwrap();
        let result = stats(&state).unwrap();
        assert_eq!(result.calls, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
