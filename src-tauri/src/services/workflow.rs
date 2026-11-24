//! 工作流审批落地：正文与阶段状态写进同一个 SQLite 事务。
//!
//! 审批原本由前端分两步做——写正文（含快照与 RAG 纪元），再写 app_meta 的阶段状态。
//! 两步之间没有事务保护，任一步失败都会留下半写状态：要么正文已覆盖但阶段仍待审批，
//! 要么界面显示已通过但正文没写。这里把两步收进一个命令、一个事务，成功才一起可见。

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::models::ApplyWorkflowInput;
use crate::services::{draft, setting};

/// 与前端 workflowService 的 STATE_PREFIX / STATE_VERSION 保持一致。
/// 两边任何一边改动都必须同步，否则老状态会被判定为版本不匹配。
const STATE_PREFIX: &str = "workflow:";
const STATE_VERSION: i64 = 1;

fn state_key(project_id: &str) -> String {
    format!("{STATE_PREFIX}{project_id}")
}

/// 入口校验：前端传来的新状态必须自洽，且目标阶段确实被决定了。
///
/// 这是纯参数校验，不碰数据库——放在事务之前，坏 JSON 不必开事务。
fn validate_next_state(input: &ApplyWorkflowInput) -> Result<Value, AppError> {
    let next: Value = serde_json::from_str(&input.workflow_json)
        .map_err(|_| AppError::validation("工作流状态 JSON 无效"))?;
    if next.get("version").and_then(Value::as_i64) != Some(STATE_VERSION) {
        return Err(AppError::validation("工作流状态版本不匹配"));
    }
    let expected = if input.decision == "approved" {
        "approved"
    } else if input.decision == "rejected" {
        "rejected"
    } else {
        return Err(AppError::validation("审批决定无效"));
    };
    let actual = next
        .get("stages")
        .and_then(|stages| stages.get(&input.stage))
        .and_then(|stage| stage.get("status"))
        .and_then(Value::as_str);
    if actual != Some(expected) {
        return Err(AppError::validation("审批决定与阶段状态不一致"));
    }
    Ok(next)
}

/// 库内状态守卫：目标阶段必须仍是 pending，防止旧页面拿着过期状态重复审批。
fn ensure_pending(conn: &Connection, key: &str, stage: &str) -> Result<(), AppError> {
    let raw: Option<String> = conn
        .query_row(
            "select value from app_meta where key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    let Some(raw) = raw else {
        return Err(AppError::conflict("工作流状态不存在，请刷新后重试"));
    };
    let saved: Value = serde_json::from_str(&raw)
        .map_err(|_| AppError::conflict("工作流状态格式错误，请刷新后重试"))?;
    if saved.get("version").and_then(Value::as_i64) != Some(STATE_VERSION) {
        return Err(AppError::conflict("工作流状态版本已变，请刷新后重试"));
    }
    let status = saved
        .get("stages")
        .and_then(|stages| stages.get(stage))
        .and_then(|stage| stage.get("status"))
        .and_then(Value::as_str);
    if status != Some("pending") {
        return Err(AppError::conflict("该阶段已不是待审批状态，请刷新后重试"));
    }
    Ok(())
}

/// 一次事务写完正文（含快照与 RAG 纪元）和阶段状态。
///
/// 任何一步失败都会回滚整笔：正文已写而阶段未推进、或阶段已推进而正文没写，都不再可能。
/// 正文仍走 draft 的乐观锁，审批期间作者在写作台改过正文会报冲突，不会静默覆盖。
pub fn apply_workflow(state: &DbState, input: ApplyWorkflowInput) -> Result<(), AppError> {
    validate_next_state(&input)?;

    let conn = state.biz();
    let key = state_key(&input.project_id);
    let tx = conn.unchecked_transaction().map_err(AppError::from)?;
    ensure_pending(&tx, &key, &input.stage)?;
    if let Some(write) = &input.content_write {
        draft::save_content_in(&tx, write)?;
    }
    setting::set_in(&tx, &key, &input.workflow_json)?;
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests;
