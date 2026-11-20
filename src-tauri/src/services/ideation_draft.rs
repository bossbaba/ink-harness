//! 构思向导草稿持久化。
//!
//! 前端在访谈输入、步骤切换、生成结果变化时防抖写入，同时按作品恢复；
//! 一个作品只保留一份草稿，最后写入的版本覆盖旧的（没有多端冲突语义）。

use rusqlite::params;

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::models::{IdeationDraft, IdeationDraftInput};

/// 时间戳 SQL 片段，与其它表同口径（SQLite 生成 UTC 毫秒）。
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/// 读取作品草稿；没写过返回 None，由前端决定用空表单还是默认值。
pub fn load(state: &DbState, project_id: &str) -> Result<Option<IdeationDraft>, AppError> {
    use rusqlite::OptionalExtension;
    let conn = state.biz();
    conn.query_row(
        "select project_id, answers_json, proposal_json, step, max_step, selected_title,
                include_outline, applied, outline_created, updated_at
           from ideation_draft where project_id = ?1",
        params![project_id],
        |row| {
            Ok(IdeationDraft {
                project_id: row.get(0)?,
                answers_json: row.get(1)?,
                proposal_json: row.get(2)?,
                step: row.get(3)?,
                max_step: row.get(4)?,
                selected_title: row.get(5)?,
                include_outline: row.get(6)?,
                applied: row.get(7)?,
                outline_created: row.get(8)?,
                updated_at: row.get(9)?,
            })
        },
    )
    .optional()
    .map_err(AppError::from)
}

/// 写入草稿（按 project_id upsert），返回落库后的完整记录。
///
/// 用 upsert 而不是先查再插：前端是防抖写入，切页时可能连发两次，
/// 先查再插在极短间隔内会撞主键，upsert 一步到位也不会出现半截状态。
pub fn save(state: &DbState, input: &IdeationDraftInput) -> Result<IdeationDraft, AppError> {
    let project_id = input.project_id.trim();
    if project_id.is_empty() {
        return Err(AppError::validation("缺少作品 ID，无法保存构思草稿"));
    }
    let conn = state.biz();
    let sql = format!(
        "insert into ideation_draft
             (project_id, answers_json, proposal_json, step, max_step, selected_title,
              include_outline, applied, outline_created, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, {NOW})
         on conflict(project_id) do update set
             answers_json = excluded.answers_json,
             proposal_json = excluded.proposal_json,
             step = excluded.step,
             max_step = excluded.max_step,
             selected_title = excluded.selected_title,
             include_outline = excluded.include_outline,
             applied = excluded.applied,
             outline_created = excluded.outline_created,
             updated_at = excluded.updated_at"
    );
    conn.execute(
        &sql,
        params![
            project_id,
            // 入参是引用，取字段要显式借用，否则会把 String 从借用的结构体里移出去。
            &input.answers_json,
            &input.proposal_json,
            input.step,
            input.max_step,
            input.selected_title,
            input.include_outline,
            input.applied,
            input.outline_created,
        ],
    )
    .map_err(AppError::from)?;
    load(state, project_id)?.ok_or_else(|| AppError::internal("草稿写入后读取失败"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db::open;
    use crate::infrastructure::id::gen_id;

    fn temp_state() -> (DbState, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("ink-ideation-test-{}", gen_id("d")));
        std::fs::create_dir_all(&dir).unwrap();
        (open(&dir).unwrap(), dir)
    }

    fn input(project_id: &str, step: i64) -> IdeationDraftInput {
        IdeationDraftInput {
            project_id: project_id.into(),
            answers_json: r#"{"inspiration":"末日后的修复师"}"#.into(),
            proposal_json: String::new(),
            step,
            max_step: step,
            selected_title: "废墟之上".into(),
            include_outline: true,
            applied: false,
            outline_created: false,
        }
    }

    #[test]
    fn save_then_load_roundtrip() {
        let (state, dir) = temp_state();
        assert!(load(&state, "p1").unwrap().is_none(), "没写过应返回 None");

        let saved = save(&state, &input("p1", 1)).unwrap();
        assert_eq!(saved.step, 1);
        assert!(saved.answers_json.contains("修复师"));
        assert!(!saved.updated_at.is_empty());

        let loaded = load(&state, "p1").unwrap().unwrap();
        assert_eq!(loaded.selected_title, "废墟之上");
    }

    #[test]
    fn save_twice_updates_same_row() {
        let (state, dir) = temp_state();
        save(&state, &input("p1", 1)).unwrap();
        // 第二次写入应覆盖而不是插出第二行，否则恢复时读到哪份就不确定了。
        let updated = save(&state, &input("p1", 2)).unwrap();
        assert_eq!(updated.step, 2);
        let conn = state.biz();
        let count: i64 = conn
            .query_row("select count(*) from ideation_draft", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_project_id_is_rejected() {
        let (state, dir) = temp_state();
        let err = save(&state, &input("  ", 0)).unwrap_err();
        assert!(err.to_string().contains("作品 ID"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
