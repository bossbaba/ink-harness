//! 调用用量：流式对话结束后把 token 数写进 agent_run，并给看板提供聚合结果。
use crate::error::AppError;
use crate::infrastructure::{db::DbState, id::gen_id};
use crate::models::{ChatParams, ModelUsage, TaskUsage, TokenUsage, UsageStats};
use rusqlite::params;

/// 写一条调用记录。没有作品 ID 时不写：agent_run.project_id 是外键，
/// 全局设置这类请求也不该混进某部作品的用量看板。
pub fn record(state: &DbState, params: &ChatParams, usage: &TokenUsage) -> Result<(), AppError> {
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
         values (?1, ?2, ?3, ?4, '', '', ?5, ?6, ?7, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![
            gen_id("run"),
            project_id,
            task_kind,
            params.model,
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
    use crate::models::ChatMessage;

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
            }],
            temperature: None,
            max_tokens: None,
            privacy_local_only: false,
            task_kind: task.map(|s| s.to_string()),
            project_id: project.map(|s| s.to_string()),
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
    fn record_accumulates_tokens_and_calls() {
        let (state, dir) = temp_state("accumulate");
        record(&state, &params("m", Some("continue"), Some("p1")), &usage(10, 5)).unwrap();
        record(&state, &params("m", Some("continue"), Some("p1")), &usage(20, 7)).unwrap();
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
        record(&state, &params("m", Some("continue"), Some("p1")), &usage(10, 0)).unwrap();
        record(&state, &params("m", Some("polish"), Some("p1")), &usage(5, 0)).unwrap();
        record(&state, &params("m", None, Some("p1")), &usage(3, 0)).unwrap();
        let result = stats(&state).unwrap();
        assert_eq!(result.by_task.len(), 3);
        assert_eq!(result.by_task.iter().find(|i| i.task_kind == "unknown").unwrap().tokens, 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn record_without_project_is_skipped() {
        // 没有作品 ID 的请求（如全局设置）不该混进用量看板。
        let (state, dir) = temp_state("no-project");
        record(&state, &params("m", None, None), &usage(10, 5)).unwrap();
        record(&state, &params("m", None, Some("")), &usage(10, 5)).unwrap();
        let result = stats(&state).unwrap();
        assert_eq!(result.calls, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
