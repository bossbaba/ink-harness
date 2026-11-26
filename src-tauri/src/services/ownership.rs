//! 资源归属校验：按 id 读写资源时核对它是否属于调用方声明的作品。
//!
//! 前端工具层已经按当前作品的 `projectId` 校验过一次，这里再做一遍是纵深防御：
//! 防止新增的调用方漏传作用域，也防止模型参数里的实体 id 被换成本库别的作品。
//!
//! 注意这不构成安全边界：IPC 调用方可以自己传 `project_id`。本层保证的是
//! 「声明的作用域与库里记录的归属不一致时显式失败」，让跨作品调用静默串数据的
//! 风险变成可见错误；真正挡住注入的是前端工具层的 `ctx.projectId` 校验与
//! 人工审批流程。

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::AppError;
use crate::infrastructure::db::DbState;

/// 按主键查某张资源表的所属作品，与调用方声明的作品比对。
///
/// `table` 只接收本文件里写死的常量，不接外部输入，拼 SQL 不构成注入面。
/// 两种失败都用 `not_found`：调用方不该从错误里区分「不属于我」和「不存在」。
fn assert_owner(
    conn: &Connection,
    table: &str,
    id: &str,
    project_id: &str,
    label: &str,
) -> Result<(), AppError> {
    let sql = format!("select project_id from {table} where id = ?1");
    let owner: Option<String> = conn
        .query_row(&sql, params![id], |row| row.get(0))
        .optional()
        .map_err(AppError::from)?;
    match owner {
        Some(owner) if owner == project_id => Ok(()),
        Some(_) => Err(AppError::not_found(format!("{label}不属于当前作品"))),
        None => Err(AppError::not_found(format!("{label}不存在"))),
    }
}

/// 创建类命令的落点作品必须存在，否则会写出没有父记录的孤儿数据。
pub fn assert_project(state: &DbState, project_id: &str) -> Result<(), AppError> {
    let exists: bool = state
        .biz()
        .query_row(
            "select exists(select 1 from project where id = ?1)",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    if exists {
        Ok(())
    } else {
        Err(AppError::not_found("作品不存在"))
    }
}

/// 章节必须属于声明的作品；正文读写、版本列表都走这里。
pub fn assert_chapter(
    state: &DbState,
    chapter_id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    assert_owner(&state.biz(), "chapter", chapter_id, project_id, "章节")
}

/// 设定条目必须属于声明的作品。
pub fn assert_element(state: &DbState, id: &str, project_id: &str) -> Result<(), AppError> {
    assert_owner(&state.biz(), "story_element", id, project_id, "设定条目")
}

/// 场景不直接带作品字段，要通过所属章节反查。
pub fn assert_scene(state: &DbState, id: &str, project_id: &str) -> Result<(), AppError> {
    let owner: Option<String> = state
        .biz()
        .query_row(
            "select c.project_id from scene s join chapter c on c.id = s.chapter_id where s.id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    match owner {
        Some(owner) if owner == project_id => Ok(()),
        Some(_) => Err(AppError::not_found("场景不属于当前作品")),
        None => Err(AppError::not_found("场景不存在")),
    }
}

/// 伏笔表自带 `project_id`，但请求体里的值不能直接采信，必须和库里比对。
pub fn assert_foreshadow(state: &DbState, id: &str, project_id: &str) -> Result<(), AppError> {
    assert_owner(&state.biz(), "foreshadow", id, project_id, "伏笔")
}

/// 版本快照本身不带作品字段，先由 version 反查章节，再核对该章节的归属。
pub fn assert_version(
    state: &DbState,
    version_id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    let conn = state.biz();
    let chapter_id: Option<String> = conn
        .query_row(
            "select chapter_id from draft_version where id = ?1",
            params![version_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    match chapter_id {
        Some(chapter_id) => assert_owner(&conn, "chapter", &chapter_id, project_id, "版本"),
        None => Err(AppError::not_found("版本不存在")),
    }
}

#[cfg(test)]
mod tests;
