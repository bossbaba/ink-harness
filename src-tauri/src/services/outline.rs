//! 大纲领域服务的模块入口：章节 CRUD、快照查询与共享校验。
//! 场景与伏笔拆到子模块，避免单文件过长；共享的列名/行映射通过 pub(super) 暴露。

mod foreshadow;
mod scene;

pub use self::foreshadow::{create_foreshadow, delete_foreshadow, update_foreshadow};
pub use self::scene::{create_scene, delete_scene, move_scene, update_scene};

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::infrastructure::id::gen_id;
use crate::models::{Chapter, Foreshadow, MoveChapter, NewChapter, OutlineSnapshot, Scene};

/// 章节状态机：待写 → 写作中 → 完成。
pub const CHAPTER_STATUSES: [&str; 3] = ["planned", "drafting", "done"];
/// 伏笔状态机：待铺设 → 已铺设 → 已回收。
pub const FORESHADOW_STATUSES: [&str; 3] = ["planned", "setup", "paid-off"];
/// 幕次取值范围：与前端 `MAX_ACTS`(99) 对齐。之前写死 3 会让「新增第四幕」建章直接报错，
/// 而大纲页却已经把幕数存进 app_meta，表现为「幕加得出来，章节加不进去」。
pub(super) const ACT_MIN: i64 = 1;
pub(super) const ACT_MAX: i64 = 99;

const CHAPTER_COLUMNS: &str =
    "id, project_id, act, title, summary, status, word_count, meta_revision, sort_order, created_at, updated_at";

fn row_to_chapter(row: &rusqlite::Row<'_>) -> rusqlite::Result<Chapter> {
    Ok(Chapter {
        id: row.get(0)?,
        project_id: row.get(1)?,
        act: row.get(2)?,
        title: row.get(3)?,
        summary: row.get(4)?,
        status: row.get(5)?,
        word_count: row.get(6)?,
        meta_revision: row.get(7)?,
        sort_order: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

pub(crate) fn query_chapters(
    conn: &Connection,
    project_id: &str,
) -> Result<Vec<Chapter>, AppError> {
    let mut stmt = conn
        .prepare(&format!(
            // 最后再按 id 兜底：同幕同序（历史数据/并发插入）时顺序也必须稳定，
            // 否则每次刷新可能换位置，拖拽结果看起来「自己乱跳」。
            "select {CHAPTER_COLUMNS} from chapter where project_id = ?1 \
             order by act, sort_order, created_at, id"
        ))
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![project_id], row_to_chapter)
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
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
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
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
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
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
        Err(AppError::validation(format!(
            "不支持的{label}状态：{status}"
        )))
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
    let existing: Option<(i64, i64, i64)> = conn
        .query_row(
            "select act, sort_order, meta_revision from chapter where id = ?1",
            params![chapter.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(AppError::from)?;
    let (old_act, old_order, db_meta_revision) =
        existing.ok_or_else(|| AppError::not_found("章节不存在"))?;

    // 乐观锁用元数据自己的计数器：正文自动保存只推进 content_revision / updated_at，
    // 不再顶掉大纲页读到的基准。`meta_revision = -1` 表示调用方明确放弃校验。
    let expected = chapter.meta_revision;
    if expected >= 0 && expected != db_meta_revision {
        return Err(AppError::conflict("章节已在其他页面被修改，请刷新后再保存"));
    }

    // 改幕次时排到新幕末尾，避免与已有章节的 sort_order 冲突。
    let sort_order = if chapter.act == old_act {
        old_order
    } else {
        next_chapter_order(&conn, &chapter.project_id, chapter.act)?
    };
    let tx = conn.unchecked_transaction().map_err(AppError::from)?;
    let changed = tx
        .execute(
            // 元数据版本在事务内递增，条件更新兜住「读到基准后又有人改过」的并发窗口。
            // updated_at 只用于界面排序/展示，不再承担乐观锁职责。
            r#"update chapter set act=?2, title=?3, summary=?4, status=?5, sort_order=?6,
               meta_revision = meta_revision + 1,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
               where id=?1 and (?7 < 0 or meta_revision = ?7)"#,
            params![
                chapter.id,
                chapter.act,
                title,
                chapter.summary,
                chapter.status,
                sort_order,
                expected
            ],
        )
        .map_err(AppError::from)?;
    if changed == 0 {
        return Err(AppError::conflict("章节已在其他页面被修改，请刷新后再保存"));
    }
    // 标题与幕次都会出现在 RAG 片段的标题里（「第N幕 · 标题」），改动同样让索引过期。
    crate::services::rag::bump_content_epoch(&tx, &chapter.project_id)?;
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

/// 只更新章节摘要。
///
/// 摘要由 AI 自动生成、保存频繁，不能走 `update_chapter` 的整对象提交：
/// 那样会把缓存里的 `title/act/status` 一起写回去（尤其是正文保存刚推进的 status）。
/// 这里也不 bump `updated_at`：摘要不属于 RAG 片段，不该让索引被判成过期。
pub fn update_chapter_summary(state: &DbState, id: &str, summary: &str) -> Result<(), AppError> {
    let conn = state.biz();
    let changed = conn
        .execute(
            "update chapter set summary = ?2 where id = ?1",
            params![id, summary],
        )
        .map_err(AppError::from)?;
    if changed == 0 {
        return Err(AppError::not_found("章节不存在"));
    }
    Ok(())
}

pub fn delete_chapter(state: &DbState, id: &str) -> Result<(), AppError> {
    {
        let conn = state.biz();
        // 先记住所属作品与幕：删完要把同幕剩余章节重新编号，不能留空洞。
        let (project_id, act): (String, i64) = conn
            .query_row(
                "select project_id, act from chapter where id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::not_found("章节不存在"))?;

        // 这一步必须同事务：解绑伏笔、删章节、重排、清旁路元数据中间失败会留下半更新状态。
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

        // 同幕剩余章节按原顺序压缩到 0..n，避免 sort_order 出现空洞（拖拽下标会按数组长度算）。
        let mut stmt = tx
            .prepare(
                "select id from chapter where project_id = ?1 and act = ?2 \
                 order by sort_order, id",
            )
            .map_err(AppError::from)?;
        let remaining: Vec<String> = stmt
            .query_map(params![project_id, act], |row| row.get(0))
            .map_err(AppError::from)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::from)?;
        drop(stmt);
        for (order, chapter_id) in remaining.iter().enumerate() {
            tx.execute(
                "update chapter set sort_order = ?2 where id = ?1",
                params![chapter_id, order as i64],
            )
            .map_err(AppError::from)?;
        }

        // 摘要缓存挂在 app_meta 上，没有外键；不清理会随删章慢慢堆积。
        tx.execute(
            "delete from app_meta where key = 'summary_meta:' || ?1",
            params![id],
        )
        .map_err(AppError::from)?;
        // 索引片段与章节之间没有外键，必须和删章放在同一个事务里：
        // 提交后再清一旦失败，已删除的正文仍会被 RAG 当成参考资料检索出来，
        // 只能靠日志和下次启动兜底。同事务后要么两件事都成，要么都不发生。
        crate::services::rag::purge_source_in(&tx, id)?;
        // 删章也是一次内容变更，纪元一起前进：索引里其它章节的片段同样可能已落后，
        // status 据此如实提示过期（检索会短路返回空，而不是拿旧正文续写）。
        crate::services::rag::bump_content_epoch(&tx, &project_id)?;
        tx.commit().map_err(AppError::from)?;
    }
    Ok(())
}

/// 章节拖拽：把章节从原幕移到目标幕的指定下标，并整幕重排 sort_order。
pub fn move_chapter(state: &DbState, input: &MoveChapter) -> Result<(), AppError> {
    // 越界报错而不是静默 clamp：clamp 会让拖拽「看起来成功但落到别的幕」。
    validate_act(input.target_act)?;
    let conn = state.biz();
    let mut chapters = query_chapters(&conn, &input.project_id)?;
    let index = chapters
        .iter()
        .position(|chapter| chapter.id == input.chapter_id)
        .ok_or_else(|| AppError::not_found("章节不存在"))?;
    let moving = chapters.remove(index);

    // 只给数据里实际出现过的幕（加上目标幕）建桶：幕数上限是 99，
    // 按 1..=99 全建会造一堆空桶，而按实际幕建也能兼容历史数据里的越界值。
    let mut acts: Vec<i64> = chapters.iter().map(|chapter| chapter.act).collect();
    acts.push(input.target_act);
    acts.sort_unstable();
    acts.dedup();
    let mut buckets: Vec<Vec<Chapter>> = acts
        .iter()
        .map(|act| {
            chapters
                .iter()
                .filter(|chapter| chapter.act == *act)
                .cloned()
                .collect()
        })
        .collect();
    let bucket_index = acts
        .iter()
        .position(|act| *act == input.target_act)
        .ok_or_else(|| AppError::internal("目标幕未进入分桶"))?;
    let bucket = &mut buckets[bucket_index];
    let insert_at = input.target_index.min(bucket.len());
    bucket.insert(insert_at, moving);

    let tx = conn.unchecked_transaction().map_err(AppError::from)?;
    for (index, bucket) in buckets.iter().enumerate() {
        let act = acts[index];
        for (order, chapter) in bucket.iter().enumerate() {
            tx.execute(
                r#"update chapter set act=?2, sort_order=?3,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=?1"#,
                params![chapter.id, act, order as i64],
            )
            .map_err(AppError::from)?;
        }
    }
    // 跨幕移动会改变片段标题里的幕次，索引同样视为过期。
    crate::services::rag::bump_content_epoch(&tx, &input.project_id)?;
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests;
