//! 调用用量：流式对话结束后把 token 数写进 agent_run，并给看板提供聚合结果。
use crate::infrastructure::{db::DbState, id::gen_id};
use crate::models::{ChatParams, TokenUsage};
use rusqlite::params;
use serde::Serialize;

/// 按任务聚合的一行：任务名、调用次数、消耗 token。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUsage {
    pub task_kind: String,
    pub calls: i64,
    pub tokens: i64,
}

/// 按模型聚合的一行：模型标识、调用次数、消耗 token。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub calls: i64,
    pub tokens: i64,
}

/// 看板总览：总量与按任务、按模型拆分。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub calls: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub by_task: Vec<TaskUsage>,
    pub by_model: Vec<ModelUsage>,
}

/// 写一条调用记录。没有作品 ID 时不写：agent_run.project_id 是外键，
/// 全局设置这类请求也不该混进某部作品的用量看板。
pub fn record(state: &DbState, params: &ChatParams, usage: &TokenUsage) -> Result<(), String> {
    let Some(project_id) = params.project_id.as_deref().filter(|id| !id.is_empty()) else {
        return Ok(());
    };
    let task_kind = params
        .task_kind
        .as_deref()
        .filter(|kind| !kind.is_empty())
        .unwrap_or("unknown");
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
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
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 聚合全部记录。成本留在前端按模型配置里的单价估算：
/// 单价是配置项，改价后不该回头改写历史消耗。
pub fn stats(state: &DbState) -> Result<UsageStats, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
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
    ).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "select task_kind, count(*), coalesce(sum(tokens),0) from agent_run group by task_kind order by sum(tokens) desc",
    ).map_err(|e| e.to_string())?;
    let by_task = stmt
        .query_map([], |row| {
            Ok(TaskUsage {
                task_kind: row.get(0)?,
                calls: row.get(1)?,
                tokens: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "select model, count(*), coalesce(sum(tokens),0) from agent_run group by model order by sum(tokens) desc",
    ).map_err(|e| e.to_string())?;
    let by_model = stmt
        .query_map([], |row| {
            Ok(ModelUsage {
                model: row.get(0)?,
                calls: row.get(1)?,
                tokens: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(UsageStats {
        calls,
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: total,
        by_task,
        by_model,
    })
}
