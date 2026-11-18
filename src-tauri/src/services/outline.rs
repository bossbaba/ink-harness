//! 大纲领域服务的模块入口：章节 CRUD、快照查询与共享校验。
//! 场景与伏笔拆到子模块，避免单文件过长；共享的列名/行映射通过 pub(super) 暴露。

mod foreshadow;
mod scene;

pub use self::foreshadow::{create_foreshadow, delete_foreshadow, update_foreshadow};
pub use self::scene::{create_scene, delete_scene, move_scene, update_scene};

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::infrastructure::id::gen_id;
use crate::models::{Chapter, Foreshadow, MoveChapter, NewChapter, OutlineSnapshot, Scene};

/// 章节状态机：待写 → 写作中 → 完成。
pub const CHAPTER_STATUSES: [&str; 3] = ["planned", "drafting", "done"];
/// 伏笔状态机：待铺设 → 已铺设 → 已回收。
pub const FORESHADOW_STATUSES: [&str; 3] = ["planned", "setup", "paid-off"];
/// 幕次取值范围，超出直接报错，不做静默兜底。
pub(super) const ACT_MIN: i64 = 1;
pub(super) const ACT_MAX: i64 = 3;

const CHAPTER_COLUMNS: &str =
    "id, project_id, act, title, summary, status, word_count, sort_order, created_at, updated_at";

fn row_to_chapter(row: &rusqlite::Row<'_>) -> rusqlite::Result<Chapter> {
    Ok(Chapter {
        id: row.get(0)?,
        project_id: row.get(1)?,
        act: row.get(2)?,
        title: row.get(3)?,
        summary: row.get(4)?,
        status: row.get(5)?,
        word_count: row.get(6)?,
        sort_order: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub(crate) fn query_chapters(conn: &Connection, project_id: &str) -> Result<Vec<Chapter>, AppError> {
    let mut stmt = conn
        .prepare(&format!(
            "select {CHAPTER_COLUMNS} from chapter where project_id = ?1 \
             order by act, sort_order, created_at"
        ))
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![project_id], row_to_chapter)
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}

pub(crate) fn query_scenes(conn: &Connection, project_id: &str) -> Result<Vec<Scene>, AppError> {
    // 场景本身不含 project_id，用章节表 join 限定作品范围，并保持看板展示顺序。
    let mut stmt = conn
        .prepare(&format!(
            "select {} from scene s join chapter c on s.chapter_id = c.id \
             where c.project_id = ?1 order by c.act, c.sort_order, s.sort_order",
            scene::SCENE_JOIN_COLUMNS
        ))
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![project_id], scene::row_to_scene)
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}

pub(crate) fn query_foreshadows(
    conn: &Connection,
    project_id: &str,
) -> Result<Vec<Foreshadow>, AppError> {
    let mut stmt = conn
        .prepare(&format!(
            "select {} from foreshadow where project_id = ?1 order by rowid",
            foreshadow::FORESHADOW_COLUMNS
        ))
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![project_id], foreshadow::row_to_foreshadow)
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}

pub(super) fn project_exists(conn: &Connection, project_id: &str) -> Result<bool, AppError> {
    conn.query_row(
        "select 1 from project where id = ?1",
        params![project_id],
        |_| Ok(()),
    )
    .optional()
    .map(|value| value.is_some())
    .map_err(AppError::from)
}

pub(super) fn chapter_project(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<String>, AppError> {
    conn.query_row(
        "select project_id from chapter where id = ?1",
        params![chapter_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(AppError::from)
}

fn validate_act(act: i64) -> Result<(), AppError> {
    if (ACT_MIN..=ACT_MAX).contains(&act) {
        Ok(())
    } else {
        Err(AppError::validation(format!(
            "幕次必须是 {ACT_MIN}~{ACT_MAX}，收到 {act}"
        )))
    }
}

pub(super) fn validate_status(status: &str, allowed: &[&str], label: &str) -> Result<(), AppError> {
    if allowed.contains(&status) {
        Ok(())
    } else {
        Err(AppError::validation(format!("不支持的{label}状态：{status}")))
    }
}

fn next_chapter_order(conn: &Connection, project_id: &str, act: i64) -> Result<i64, AppError> {
    conn.query_row(
        "select coalesce(max(sort_order), -1) + 1 from chapter where project_id = ?1 and act = ?2",
        params![project_id, act],
        |row| row.get(0),
    )
    .map_err(AppError::from)
}

pub fn snapshot(state: &DbState, project_id: &str) -> Result<OutlineSnapshot, AppError> {
    let conn = state.biz();
    Ok(OutlineSnapshot {
        chapters: query_chapters(&conn, project_id)?,
        scenes: query_scenes(&conn, project_id)?,
        foreshadows: query_foreshadows(&conn, project_id)?,
    })
}

pub fn get_chapter(state: &DbState, id: &str) -> Result<Option<Chapter>, AppError> {
    let conn = state.biz();
    conn.query_row(
        &format!("select {CHAPTER_COLUMNS} from chapter where id = ?1"),
        params![id],
        row_to_chapter,
    )
    .optional()
    .map_err(AppError::from)
}

pub fn create_chapter(state: &DbState, input: NewChapter) -> Result<Chapter, AppError> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::validation("章节标题不能为空"));
    }
    validate_act(input.act)?;
    validate_status(&input.status, &CHAPTER_STATUSES, "章节")?;

    let conn = state.biz();
    if !project_exists(&conn, &input.project_id)? {
        return Err(AppError::not_found("作品不存在"));
    }
    let sort_order = next_chapter_order(&conn, &input.project_id, input.act)?;
    let id = gen_id("ch");
    conn.execute(
        r#"insert into chapter
           (id, project_id, act, title, summary, status, sort_order, created_at, updated_at)
           values (?1, ?2, ?3, ?4, ?5, ?6, ?7,
                   strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))"#,
        params![
            id,
            input.project_id,
            input.act,
            title,
            input.summary,
            input.status,
            sort_order
        ],
    )
    .map_err(AppError::from)?;
    drop(conn);
    get_chapter(state, &id)?.ok_or_else(|| AppError::internal("创建后读取章节失败"))
}

pub fn update_chapter(state: &DbState, chapter: &Chapter) -> Result<(), AppError> {
    let title = chapter.title.trim();
    if title.is_empty() {
        return Err(AppError::validation("章节标题不能为空"));
    }
    validate_act(chapter.act)?;
    validate_status(&chapter.status, &CHAPTER_STATUSES, "章节")?;

    let conn = state.biz();
    let existing: Option<(i64, i64)> = conn
        .query_row(
            "select act, sort_order from chapter where id = ?1",
            params![chapter.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(AppError::from)?;
    let (old_act, old_order) = existing.ok_or_else(|| AppError::not_found("章节不存在"))?;
    // 改幕次时排到新幕末尾，避免与已有章节的 sort_order 冲突。
    let sort_order = if chapter.act == old_act {
        old_order
    } else {
        next_chapter_order(&conn, &chapter.project_id, chapter.act)?
    };
    conn.execute(
        r#"update chapter set act=?2, title=?3, summary=?4, status=?5, sort_order=?6,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=?1"#,
        params![
            chapter.id,
            chapter.act,
            title,
            chapter.summary,
            chapter.status,
            sort_order
        ],
    )
    .map_err(AppError::from)?;
    Ok(())
}

pub fn delete_chapter(state: &DbState, id: &str) -> Result<(), AppError> {
    {
        let conn = state.biz();
        // 三步必须同事务：解绑伏笔与删章节中间失败会留下「伏笔丢失但章节还在」的半更新状态。
        let tx = conn.unchecked_transaction().map_err(AppError::from)?;
        // 伏笔的章节引用没有外键约束，删章前先解除，避免看板出现悬空引用。
        tx.execute(
            "update foreshadow set setup_chapter_id = null where setup_chapter_id = ?1",
            params![id],
        )
        .map_err(AppError::from)?;
        tx.execute(
            "update foreshadow set payoff_chapter_id = null where payoff_chapter_id = ?1",
            params![id],
        )
        .map_err(AppError::from)?;
        // scene 通过外键 on delete cascade 跟随删除。
        tx.execute("delete from chapter where id = ?1", params![id])
            .map_err(AppError::from)?;
        tx.commit().map_err(AppError::from)?;
    }
    // 索引片段与章节没有外键：不清理的话，已删除的正文仍会被 RAG 当成参考资料检索出来。
    // 放在锁外调用，避免同一把业务库锁被嵌套获取。
    crate::services::rag::purge_source(state, id)
}

/// 章节拖拽：把章节从原幕移到目标幕的指定下标，并整幕重排 sort_order。
pub fn move_chapter(state: &DbState, input: &MoveChapter) -> Result<(), AppError> {
    let target_act = input.target_act.clamp(ACT_MIN, ACT_MAX);
    let conn = state.biz();
    let mut chapters = query_chapters(&conn, &input.project_id)?;
    let index = chapters
        .iter()
        .position(|chapter| chapter.id == input.chapter_id)
        .ok_or_else(|| AppError::not_found("章节不存在"))?;
    let moving = chapters.remove(index);

    // 按幕拆桶后插入；chapters 已按 act、sort_order 排好序，桶内顺序即当前顺序。
    let mut buckets: Vec<Vec<Chapter>> = (ACT_MIN..=ACT_MAX)
        .map(|act| {
            chapters
                .iter()
                .filter(|chapter| chapter.act == act)
                .cloned()
                .collect()
        })
        .collect();
    let bucket = &mut buckets[(target_act - ACT_MIN) as usize];
    let insert_at = input.target_index.min(bucket.len());
    bucket.insert(insert_at, moving);

    let tx = conn.unchecked_transaction().map_err(AppError::from)?;
    for (act_index, bucket) in buckets.iter().enumerate() {
        for (order, chapter) in bucket.iter().enumerate() {
            tx.execute(
                r#"update chapter set act=?2, sort_order=?3,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=?1"#,
                params![chapter.id, act_index as i64 + ACT_MIN, order as i64],
            )
            .map_err(AppError::from)?;
        }
    }
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests;
