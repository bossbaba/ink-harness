//! 命令层的资源归属校验。
//!
//! 前端已经按当前作品的 `projectId` 校验过一次，这里再做一遍是纵深防御：
//! 防止新增的调用方漏传作用域，也防止模型参数里的实体 id 被换成本库别的作品。
//!
//! 注意这不构成安全边界：IPC 调用方可以自己传 `project_id`。真正挡住注入的是
//! 前端工具层的 `ctx.projectId` 校验；本层保证的是「写了哪个作品就必须报哪个作品」，
//! 让跨作品调用在数据库层面显式失败而不是静默串数据。

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::AppError;
use crate::infrastructure::db::DbState;

/// 按主键查某张资源表的所属作品，与调用方声明的作品比对。
///
/// `table` 只接收本文件里写死的常量，不接外部输入，拼 SQL 不构成注入面。
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

/// 章节必须属于声明的作品；正文读写、版本列表都走这里。
pub(super) fn assert_chapter(
    state: &DbState,
    chapter_id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    assert_owner(&state.biz(), "chapter", chapter_id, project_id, "章节")
}

/// 设定条目必须属于声明的作品。
pub(super) fn assert_element(
    state: &DbState,
    id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    assert_owner(&state.biz(), "story_element", id, project_id, "设定条目")
}

/// 版本快照本身不带作品字段，先由 version 反查章节，再核对该章节的归属。
pub(super) fn assert_version(
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
