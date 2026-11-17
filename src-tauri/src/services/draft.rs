//! 写作台正文服务：章节正文读写与版本快照。
//!
//! 设计取舍：
//! - 正文存 `chapter.content`（TipTap 文档 JSON 字符串），与章节元数据同表但列表查询不 select，
//!   避免大纲/写作台的章节列表把几十份全文一起拖下来。
//! - 版本快照复用 `draft_version` 表：一次保存是否留快照由「是否手动要求 + 与上一版的字数差」决定，
//!   自动保存不会每次都写一版，否则几十次防抖保存就把表写爆了。
//! - 恢复历史版本前会先把当前正文存一版，防止「点了恢复，刚写的几百字没了」。

use rusqlite::{params, Connection, OptionalExtension};

use crate::infrastructure::db::DbState;
use crate::infrastructure::id::gen_id;
use crate::models::{ChapterContent, DraftVersion, DraftVersionBrief, SaveContentInput};

/// 自动快照阈值：字数相对上一版变化超过 500 字才留版，兼顾可回溯与库体积。
const AUTO_SNAPSHOT_CHARS: i64 = 500;
/// 每章最多保留的版本数，超出后删最旧的。
const MAX_VERSIONS_PER_CHAPTER: i64 = 50;

fn row_to_content(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChapterContent> {
    Ok(ChapterContent {
        chapter_id: row.get(0)?,
        content: row.get(1)?,
        word_count: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

/// 读取章节正文；章节不存在直接报错，不做「返回空正文」的兜底——
/// 空正文与不存在的章节在写作台上必须区分开，否则用户会以为正文丢了。
pub fn get_content(state: &DbState, chapter_id: &str) -> Result<ChapterContent, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    query_content(&conn, chapter_id)?.ok_or_else(|| "章节不存在".to_string())
}

fn query_content(conn: &Connection, chapter_id: &str) -> Result<Option<ChapterContent>, String> {
    conn.query_row(
        "select id, content, word_count, updated_at from chapter where id = ?1",
        params![chapter_id],
        row_to_content,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// 章节当前正文 + 上一版快照的字数与内容，用于判断是否需要留快照。
struct DraftState {
    content: String,
    word_count: i64,
}

fn query_draft_state(conn: &Connection, chapter_id: &str) -> Result<DraftState, String> {
    conn.query_row(
        "select content, word_count from chapter where id = ?1",
        params![chapter_id],
        |row| {
            Ok(DraftState {
                content: row.get(0)?,
                word_count: row.get(1)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "章节不存在".to_string())
}

/// 最近一版快照（序号、字数、正文），没有则返回 None。
fn last_version(conn: &Connection, chapter_id: &str) -> Result<Option<(i64, i64, String)>, String> {
    conn.query_row(
        "select version, word_count, content from draft_version \
         where chapter_id = ?1 order by version desc limit 1",
        params![chapter_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn next_version(conn: &Connection, chapter_id: &str) -> Result<i64, String> {
    conn.query_row(
        "select coalesce(max(version), 0) + 1 from draft_version where chapter_id = ?1",
        params![chapter_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

/// 写入一版快照，并把该章版本数裁到上限，避免历史无限增长。
fn insert_version(
    conn: &Connection,
    chapter_id: &str,
    content: &str,
    word_count: i64,
) -> Result<(), String> {
    let version = next_version(conn, chapter_id)?;
    conn.execute(
        r#"insert into draft_version (id, chapter_id, content, version, word_count, created_at)
           values (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))"#,
        params![gen_id("dv"), chapter_id, content, version, word_count],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        r#"delete from draft_version where chapter_id = ?1 and id not in (
             select id from draft_version where chapter_id = ?1 order by version desc limit ?2
           )"#,
        params![chapter_id, MAX_VERSIONS_PER_CHAPTER],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 保存正文。返回保存后的实际状态（字数、更新时间以库里的为准）。
///
/// 自动保存（snapshot=false）只更新正文；首次写入有内容时自动把章节从「待写」推进到「写作中」。
pub fn save_content(state: &DbState, input: SaveContentInput) -> Result<ChapterContent, String> {
    if input.word_count < 0 {
        return Err("字数不能为负数".into());
    }
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    let current = query_draft_state(&conn, &input.chapter_id)?;
    let content_changed = current.content != input.content;
    let previous = last_version(&conn, &input.chapter_id)?;

    // 手动「保存快照」时内容没变就不重复留版；自动保存则按字数差异阈值判断。
    // 首次落笔（还没有任何版本、且已有正文）也给一版底稿，用户误删才有东西可回。
    let last_words = previous.as_ref().map_or(0, |item| item.1);
    let last_content_differs = previous
        .as_ref()
        .map_or(true, |(_, _, last)| last != &input.content);
    let should_snapshot = content_changed
        && last_content_differs
        && (input.snapshot
            || (previous.is_none() && input.word_count > 0)
            || (input.word_count - last_words).abs() >= AUTO_SNAPSHOT_CHARS);

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        r#"update chapter set content = ?2, word_count = ?3,
             status = case when status = 'planned' and ?3 > 0 then 'drafting' else status end,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           where id = ?1"#,
        params![input.chapter_id, input.content, input.word_count],
    )
    .map_err(|e| e.to_string())?;

    if should_snapshot {
        insert_version(&tx, &input.chapter_id, &input.content, input.word_count)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);

    get_content(state, &input.chapter_id)
}

/// 版本列表：新的在前，不带正文，避免一次拉回整章全文。
pub fn list_versions(state: &DbState, chapter_id: &str) -> Result<Vec<DraftVersionBrief>, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "select id, chapter_id, version, word_count, created_at from draft_version \
             where chapter_id = ?1 order by version desc",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![chapter_id], |row| {
            Ok(DraftVersionBrief {
                id: row.get(0)?,
                chapter_id: row.get(1)?,
                version: row.get(2)?,
                word_count: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_version(state: &DbState, id: &str) -> Result<DraftVersion, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "select id, chapter_id, version, content, word_count, created_at \
         from draft_version where id = ?1",
        params![id],
        |row| {
            Ok(DraftVersion {
                id: row.get(0)?,
                chapter_id: row.get(1)?,
                version: row.get(2)?,
                content: row.get(3)?,
                word_count: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "版本不存在".to_string())
}

/// 恢复到某个历史版本：先把当前正文留一版，再用历史内容覆盖。
pub fn restore_version(state: &DbState, version_id: &str) -> Result<ChapterContent, String> {
    let conn = state.biz.lock().map_err(|e| e.to_string())?;
    let (chapter_id, content, word_count): (String, String, i64) = conn
        .query_row(
            "select chapter_id, content, word_count from draft_version where id = ?1",
            params![version_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "版本不存在".to_string())?;

    let current = query_draft_state(&conn, &chapter_id)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    // 当前正文与目标版本不同、且还没被任何快照收录时先补一版底稿，
    // 否则用户点恢复就等于把刚写的内容彻底弄丢了。
    if !current.content.trim().is_empty() && current.content != content {
        let already_saved: bool = tx
            .query_row(
                "select 1 from draft_version where chapter_id = ?1 and content = ?2 limit 1",
                params![chapter_id, current.content],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .is_some();
        if !already_saved {
            insert_version(&tx, &chapter_id, &current.content, current.word_count)?;
        }
    }
    tx.execute(
        r#"update chapter set content = ?2, word_count = ?3,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           where id = ?1"#,
        params![chapter_id, content, word_count],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);

    get_content(state, &chapter_id)
}

#[cfg(test)]
mod tests;
