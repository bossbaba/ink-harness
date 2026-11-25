//! 写作台正文服务：章节正文读写与版本快照。
//!
//! 设计取舍：
//! - 正文存 `chapter.content`（TipTap 文档 JSON 字符串），与章节元数据同表但列表查询不 select，
//!   避免大纲/写作台的章节列表把几十份全文一起拖下来。
//! - 版本快照复用 `draft_version` 表：一次保存是否留快照由「是否手动要求 + 与上一版的字数差」决定，
//!   自动保存不会每次都写一版，否则几十次防抖保存就把表写爆了。
//! - 恢复历史版本前会先把当前正文存一版，防止「点了恢复，刚写的几百字没了」。

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::AppError;
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
        content_revision: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

/// 读取章节正文；章节不存在直接报错，不做「返回空正文」的兜底——
/// 空正文与不存在的章节在写作台上必须区分开，否则用户会以为正文丢了。
pub fn get_content(state: &DbState, chapter_id: &str) -> Result<ChapterContent, AppError> {
    let conn = state.biz();
    query_content(&conn, chapter_id)?.ok_or_else(|| AppError::not_found("章节不存在"))
}

fn query_content(conn: &Connection, chapter_id: &str) -> Result<Option<ChapterContent>, AppError> {
    conn.query_row(
        "select id, content, word_count, content_revision, updated_at from chapter where id = ?1",
        params![chapter_id],
        row_to_content,
    )
    .optional()
    .map_err(AppError::from)
}

/// 章节当前正文 + 上一版快照的字数与内容，用于判断是否需要留快照。
struct DraftState {
    content: String,
    word_count: i64,
    /// 库内正文版本号，保存前用来判断前端是不是拿着旧副本。
    content_revision: i64,
}

fn query_draft_state(conn: &Connection, chapter_id: &str) -> Result<DraftState, AppError> {
    conn.query_row(
        "select content, word_count, content_revision from chapter where id = ?1",
        params![chapter_id],
        |row| {
            Ok(DraftState {
                content: row.get(0)?,
                word_count: row.get(1)?,
                content_revision: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(AppError::from)?
    .ok_or_else(|| AppError::not_found("章节不存在"))
}

/// 最近一版快照（序号、字数、正文），没有则返回 None。
fn last_version(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<(i64, i64, String)>, AppError> {
    conn.query_row(
        "select version, word_count, content from draft_version \
         where chapter_id = ?1 order by version desc limit 1",
        params![chapter_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(AppError::from)
}

/// 写入一版快照，并把该章版本数裁到上限，避免历史无限增长。
///
/// 版本号在 insert 语句里用 `max(version)+1` 现算，而不是「先查再插」：
/// 配合 `unique(chapter_id, version)` 索引，多实例并发时也不会写出重号。
fn insert_version(
    conn: &Connection,
    chapter_id: &str,
    content: &str,
    word_count: i64,
) -> Result<(), AppError> {
    conn.execute(
        r#"insert into draft_version (id, chapter_id, content, version, word_count, created_at)
           select ?1, ?2, ?3, coalesce(max(version), 0) + 1, ?4,
                  strftime('%Y-%m-%dT%H:%M:%fZ','now')
             from draft_version where chapter_id = ?2"#,
        params![gen_id("dv"), chapter_id, content, word_count],
    )
    .map_err(AppError::from)?;
    conn.execute(
        r#"delete from draft_version where chapter_id = ?1 and id not in (
             select id from draft_version where chapter_id = ?1 order by version desc limit ?2
           )"#,
        params![chapter_id, MAX_VERSIONS_PER_CHAPTER],
    )
    .map_err(AppError::from)?;
    Ok(())
}

/// 保存正文。返回保存后的实际状态（字数、更新时间以库里的为准）。
///
/// 自动保存（snapshot=false）只更新正文；首次写入有内容时自动把章节从「待写」推进到「写作中」。
pub fn save_content(state: &DbState, input: SaveContentInput) -> Result<ChapterContent, AppError> {
    let conn = state.biz();
    let tx = conn.unchecked_transaction().map_err(AppError::from)?;
    let saved = save_content_in(&tx, &input)?;
    tx.commit().map_err(AppError::from)?;
    Ok(saved)
}

/// 在调用方给的连接（必须已处于事务中）里写正文，自身不再开事务。
///
/// 抽出来是为了让工作流审批把「正文 + 阶段状态」放进同一个事务：原来前端分两次 IPC
/// （save_chapter_content + set_app_setting），中途失败会留下「正文已覆盖但阶段仍待审批」
/// 或「界面显示已通过但正文没写」的半写状态。乐观锁规则与独立保存完全一致：
/// 预检加条件 UPDATE 双重判定，冲突仍返回 `conflict`。
///
/// 注意：SQLite 不支持嵌套事务，独立保存由 `save_content` 负责开事务，
/// 工作流审批由 `workflow::apply_workflow` 负责，本函数只执行写入。
pub fn save_content_in(
    conn: &Connection,
    input: &SaveContentInput,
) -> Result<ChapterContent, AppError> {
    if input.word_count < 0 {
        return Err(AppError::validation("字数不能为负数"));
    }
    let current = query_draft_state(conn, &input.chapter_id)?;

    // 乐观锁：前端带着「我读到的正文版本」提交，库里已经变了就拒绝，
    // 否则写作台/审稿/工作流之间会互相静默覆盖（谁最后写谁赢）。
    if let Some(expected) = input.expected_content_revision {
        if expected != current.content_revision {
            return Err(AppError::conflict(
                "本章正文已在其他页面被修改，请重新载入后再保存",
            ));
        }
    }

    // RAG 的内容纪元按作品分键，先取所属作品，供事务内的过期标记使用。
    let project_id: String = conn
        .query_row(
            "select project_id from chapter where id = ?1",
            params![input.chapter_id],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;

    let content_changed = current.content != input.content;
    let previous = last_version(conn, &input.chapter_id)?;

    // 手动「保存快照」时内容没变就不重复留版；自动保存则按字数差异阈值判断。
    // 首次落笔（还没有任何版本、且已有正文）也给一版底稿，用户误删才有东西可回。
    let last_words = previous.as_ref().map_or(0, |item| item.1);
    let last_content_differs = previous
        .as_ref()
        .is_none_or(|(_, _, last)| last != &input.content);
    let should_snapshot = content_changed
        && last_content_differs
        && (input.snapshot
            || (previous.is_none() && input.word_count > 0)
            || (input.word_count - last_words).abs() >= AUTO_SNAPSHOT_CHARS);

    // 校验与写入之间仍可能被别的进程插一脚，条件里再带一次版本判定，
    // 影响行数为 0 就说明这期间被改过，由调用方回滚并报冲突。
    let changed = conn
        .execute(
            r#"update chapter set content = ?2, word_count = ?3,
                 status = case when status = 'planned' and ?3 > 0 then 'drafting' else status end,
                 content_revision = content_revision + 1,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
               where id = ?1
                 and (?4 is null or content_revision = ?4)"#,
            params![
                input.chapter_id,
                input.content,
                input.word_count,
                input.expected_content_revision
            ],
        )
        .map_err(AppError::from)?;
    if changed == 0 {
        return Err(AppError::conflict(
            "本章正文已在其他页面被修改，请重新载入后再保存",
        ));
    }

    if should_snapshot {
        insert_version(conn, &input.chapter_id, &input.content, input.word_count)?;
    }
    // 正文变了，RAG 索引随之过期；和正文写在同一个事务里，避免纪元漏加。
    crate::services::rag::bump_content_epoch(conn, &project_id)?;

    // 在同一个连接上重读，由调用方提交事务后返回给前端。
    query_content(conn, &input.chapter_id)?.ok_or_else(|| AppError::not_found("章节不存在"))
}

/// 版本列表：新的在前，不带正文，避免一次拉回整章全文。
pub fn list_versions(
    state: &DbState,
    chapter_id: &str,
) -> Result<Vec<DraftVersionBrief>, AppError> {
    let conn = state.biz();
    let mut stmt = conn
        .prepare(
            "select id, chapter_id, version, word_count, created_at from draft_version \
             where chapter_id = ?1 order by version desc",
        )
        .map_err(AppError::from)?;
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
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

pub fn get_version(state: &DbState, id: &str) -> Result<DraftVersion, AppError> {
    let conn = state.biz();
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
    .map_err(AppError::from)?
    .ok_or_else(|| AppError::not_found("版本不存在"))
}

/// 恢复到某个历史版本：先把当前正文留一版，再用历史内容覆盖。
///
/// `expected_content_revision` 是调用方看到的正文基准；不传则按库内当前版本做条件更新。
/// 事务内的 `where content_revision` 保证并发保存不会被静默覆盖：
/// A 恢复旧版、B 同时存了新稿时，先到者赢，后到者收到 conflict。
pub fn restore_version(
    state: &DbState,
    version_id: &str,
    expected_content_revision: Option<i64>,
) -> Result<ChapterContent, AppError> {
    let conn = state.biz();
    let (chapter_id, content, word_count): (String, String, i64) = conn
        .query_row(
            "select chapter_id, content, word_count from draft_version where id = ?1",
            params![version_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::not_found("版本不存在"))?;

    let current = query_draft_state(&conn, &chapter_id)?;
    if let Some(expected) = expected_content_revision {
        if expected != current.content_revision {
            return Err(AppError::conflict(
                "本章正文已在其他页面被修改，请重新载入后再恢复",
            ));
        }
    }
    // 恢复也会改变检索内容，纪元按作品分键，先取所属作品。
    let project_id: String = conn
        .query_row(
            "select project_id from chapter where id = ?1",
            params![chapter_id],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    let tx = conn.unchecked_transaction().map_err(AppError::from)?;
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
            .map_err(AppError::from)?
            .is_some();
        if !already_saved {
            insert_version(&tx, &chapter_id, &current.content, current.word_count)?;
        }
    }
    // 恢复同样是一次正文变更：递增版本号，让别处拿着的旧版本号立即失效。
    // 条件更新兜住「读完当前版本到真正写入之间又有保存」的并发窗口。
    let changed = tx
        .execute(
            r#"update chapter set content = ?2, word_count = ?3,
                 content_revision = content_revision + 1,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
               where id = ?1 and content_revision = ?4"#,
            params![chapter_id, content, word_count, current.content_revision],
        )
        .map_err(AppError::from)?;
    if changed == 0 {
        return Err(AppError::conflict(
            "本章正文已在其他页面被修改，请重新载入后再恢复",
        ));
    }
    // 恢复也是正文变更，索引同样过期。
    crate::services::rag::bump_content_epoch(&tx, &project_id)?;
    tx.commit().map_err(AppError::from)?;
    drop(conn);

    get_content(state, &chapter_id)
}

#[cfg(test)]
mod tests;
