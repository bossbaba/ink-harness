//! 场景 CRUD 与跨章拖拽：场景是章节下的最小上下文单元，排序按所属章节各自维护。

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::infrastructure::id::gen_id;
use crate::models::{MoveScene, NewScene, Scene};

use super::chapter_project;

pub(super) const SCENE_COLUMNS: &str =
    "id, chapter_id, title, pov, location, time_mark, summary, sort_order";
/// join 章节表时必须带表别名，否则 id/project_id 等列名冲突。
pub(super) const SCENE_JOIN_COLUMNS: &str =
    "s.id, s.chapter_id, s.title, s.pov, s.location, s.time_mark, s.summary, s.sort_order";

pub(super) fn row_to_scene(row: &rusqlite::Row<'_>) -> rusqlite::Result<Scene> {
    Ok(Scene {
        id: row.get(0)?,
        chapter_id: row.get(1)?,
        title: row.get(2)?,
        pov: row.get(3)?,
        location: row.get(4)?,
        time_mark: row.get(5)?,
        summary: row.get(6)?,
        sort_order: row.get(7)?,
    })
}

fn next_scene_order(conn: &Connection, chapter_id: &str) -> Result<i64, AppError> {
    conn.query_row(
        "select coalesce(max(sort_order), -1) + 1 from scene where chapter_id = ?1",
        params![chapter_id],
        |row| row.get(0),
    )
    .map_err(AppError::from)
}

fn query_scenes_of_chapter(conn: &Connection, chapter_id: &str) -> Result<Vec<Scene>, AppError> {
    let mut stmt = conn
        .prepare(&format!(
            "select {SCENE_COLUMNS} from scene where chapter_id = ?1 order by sort_order, rowid"
        ))
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![chapter_id], row_to_scene)
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

fn renumber_scenes(conn: &Connection, scenes: &[Scene]) -> Result<(), AppError> {
    for (index, scene) in scenes.iter().enumerate() {
        conn.execute(
            "update scene set sort_order = ?2 where id = ?1",
            params![scene.id, index as i64],
        )
        .map_err(AppError::from)?;
    }
    Ok(())
}

pub fn create_scene(state: &DbState, input: NewScene) -> Result<Scene, AppError> {
    let title = input.title.trim();
    let conn = state.biz();
    if chapter_project(&conn, &input.chapter_id)?.is_none() {
        return Err(AppError::not_found("章节不存在"));
    }
    let sort_order = next_scene_order(&conn, &input.chapter_id)?;
    let id = gen_id("sc");
    // 快速添加场景时允许不填标题，用占位名保证卡片可点击编辑。
    let title = if title.is_empty() {
        "未命名场景"
    } else {
        title
    };
    conn.execute(
        r#"insert into scene
           (id, chapter_id, title, sort_order, pov, location, time_mark, summary)
           values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
        params![
            id,
            input.chapter_id,
            title,
            sort_order,
            input.pov,
            input.location,
            input.time_mark,
            input.summary
        ],
    )
    .map_err(AppError::from)?;
    conn.query_row(
        &format!("select {SCENE_COLUMNS} from scene where id = ?1"),
        params![id],
        row_to_scene,
    )
    .map_err(AppError::from)
}

pub fn update_scene(state: &DbState, scene: &Scene) -> Result<(), AppError> {
    let title = scene.title.trim();
    if title.is_empty() {
        return Err(AppError::validation("场景标题不能为空"));
    }
    let conn = state.biz();
    let changed = conn
        .execute(
            r#"update scene set title=?2, pov=?3, location=?4, time_mark=?5, summary=?6
               where id=?1"#,
            params![
                scene.id,
                title,
                scene.pov,
                scene.location,
                scene.time_mark,
                scene.summary
            ],
        )
        .map_err(AppError::from)?;
    if changed == 0 {
        return Err(AppError::not_found("场景不存在"));
    }
    Ok(())
}

pub fn delete_scene(state: &DbState, id: &str) -> Result<(), AppError> {
    let conn = state.biz();
    conn.execute("delete from scene where id = ?1", params![id])
        .map_err(AppError::from)?;
    Ok(())
}

/// 场景拖拽：支持同章内换位与跨章移动，源/目标章节都重新编号。
pub fn move_scene(state: &DbState, input: &MoveScene) -> Result<(), AppError> {
    let conn = state.biz();
    let source: Option<(String,)> = conn
        .query_row(
            "select chapter_id from scene where id = ?1",
            params![input.scene_id],
            |row| Ok((row.get(0)?,)),
        )
        .optional()
        .map_err(AppError::from)?;
    let source_chapter = source.ok_or_else(|| AppError::not_found("场景不存在"))?.0;
    if chapter_project(&conn, &input.target_chapter_id)?.is_none() {
        return Err(AppError::not_found("目标章节不存在"));
    }

    let tx = conn.unchecked_transaction().map_err(AppError::from)?;
    if source_chapter != input.target_chapter_id {
        tx.execute(
            "update scene set chapter_id = ?2 where id = ?1",
            params![input.scene_id, input.target_chapter_id],
        )
        .map_err(AppError::from)?;
    }

    // 移动完成后目标章节列表已包含该场景，再按目标下标重新插入。
    let mut target_list = query_scenes_of_chapter(&tx, &input.target_chapter_id)?;
    let moving_index = target_list
        .iter()
        .position(|scene| scene.id == input.scene_id)
        .ok_or_else(|| AppError::not_found("场景不存在"))?;
    let moving = target_list.remove(moving_index);
    // 前端的 targetIndex 取自「移动前的列表」（拖到某个场景上就插到它前面）。
    // 同章向下拖时，移动项自己还占着一个位置，移除后必须减一，否则会多走一格。
    let target_index = if moving_index < input.target_index {
        input.target_index - 1
    } else {
        input.target_index
    };
    let insert_at = target_index.min(target_list.len());
    target_list.insert(insert_at, moving);
    renumber_scenes(&tx, &target_list)?;

    if source_chapter != input.target_chapter_id {
        let source_list = query_scenes_of_chapter(&tx, &source_chapter)?;
        renumber_scenes(&tx, &source_list)?;
    }
    tx.commit().map_err(AppError::from)?;
    Ok(())
}
