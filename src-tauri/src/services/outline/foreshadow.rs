//! 伏笔 CRUD：记录「铺设章节 → 回收章节」，并校验章节必须同属一部作品。

use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::infrastructure::id::gen_id;
use crate::models::{Foreshadow, NewForeshadow};

use super::{chapter_project, project_exists, validate_status, FORESHADOW_STATUSES};

pub(super) const FORESHADOW_COLUMNS: &str =
    "id, project_id, title, setup_chapter_id, payoff_chapter_id, status";

pub(super) fn row_to_foreshadow(row: &rusqlite::Row<'_>) -> rusqlite::Result<Foreshadow> {
    Ok(Foreshadow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        setup_chapter_id: row.get(3)?,
        payoff_chapter_id: row.get(4)?,
        status: row.get(5)?,
    })
}

/// 校验伏笔引用的章节必须属于同一作品，防止跨作品串线。
fn validate_chapter_owner(
    conn: &Connection,
    project_id: &str,
    chapter_id: &Option<String>,
) -> Result<(), AppError> {
    let Some(chapter_id) = chapter_id else {
        return Ok(());
    };
    match chapter_project(conn, chapter_id)? {
        Some(owner) if owner == project_id => Ok(()),
        Some(_) => Err(AppError::not_found("伏笔引用的章节不属于当前作品")),
        None => Err(AppError::not_found("伏笔引用的章节不存在")),
    }
}

pub fn create_foreshadow(state: &DbState, input: NewForeshadow) -> Result<Foreshadow, AppError> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::validation("伏笔标题不能为空"));
    }
    validate_status(&input.status, &FORESHADOW_STATUSES, "伏笔")?;
    let conn = state.biz();
    if !project_exists(&conn, &input.project_id)? {
        return Err(AppError::not_found("作品不存在"));
    }
    validate_chapter_owner(&conn, &input.project_id, &input.setup_chapter_id)?;
    validate_chapter_owner(&conn, &input.project_id, &input.payoff_chapter_id)?;
    let id = gen_id("fs");
    conn.execute(
        r#"insert into foreshadow
           (id, project_id, title, setup_chapter_id, payoff_chapter_id, status)
           values (?1, ?2, ?3, ?4, ?5, ?6)"#,
        params![
            id,
            input.project_id,
            title,
            input.setup_chapter_id,
            input.payoff_chapter_id,
            input.status
        ],
    )
    .map_err(AppError::from)?;
    conn.query_row(
        &format!("select {FORESHADOW_COLUMNS} from foreshadow where id = ?1"),
        params![id],
        row_to_foreshadow,
    )
    .map_err(AppError::from)
}

pub fn update_foreshadow(state: &DbState, foreshadow: &Foreshadow) -> Result<(), AppError> {
    let title = foreshadow.title.trim();
    if title.is_empty() {
        return Err(AppError::validation("伏笔标题不能为空"));
    }
    validate_status(&foreshadow.status, &FORESHADOW_STATUSES, "伏笔")?;
    let conn = state.biz();
    validate_chapter_owner(&conn, &foreshadow.project_id, &foreshadow.setup_chapter_id)?;
    validate_chapter_owner(&conn, &foreshadow.project_id, &foreshadow.payoff_chapter_id)?;
    let changed = conn
        .execute(
            r#"update foreshadow set title=?2, setup_chapter_id=?3, payoff_chapter_id=?4,
               status=?5 where id=?1"#,
            params![
                foreshadow.id,
                title,
                foreshadow.setup_chapter_id,
                foreshadow.payoff_chapter_id,
                foreshadow.status
            ],
        )
        .map_err(AppError::from)?;
    if changed == 0 {
        return Err(AppError::not_found("伏笔不存在"));
    }
    Ok(())
}

pub fn delete_foreshadow(state: &DbState, id: &str) -> Result<(), AppError> {
    let conn = state.biz();
    conn.execute("delete from foreshadow where id = ?1", params![id])
        .map_err(AppError::from)?;
    Ok(())
}
