//! 作品领域服务：CRUD 与草稿/向量骨架。不依赖 Tauri。

use rusqlite::{params, OptionalExtension};

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::models::{DatabaseInfo, NewProject, Project};

fn gen_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("p-{ts:x}-{n:x}")
}

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        title: row.get(1)?,
        genre: row.get(2)?,
        premise: row.get(3)?,
        audience: row.get(4)?,
        style: row.get(5)?,
        privacy: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

const SELECT_COLUMNS: &str =
    "id, title, genre, premise, audience, style, privacy, status, created_at, updated_at";

pub fn database_info(state: &DbState) -> DatabaseInfo {
    DatabaseInfo {
        path: state.path.to_string_lossy().into_owned(),
    }
}

pub fn list(state: &DbState) -> Result<Vec<Project>, AppError> {
    let conn = state.biz();
    let mut stmt = conn
        .prepare(&format!(
            "select {SELECT_COLUMNS} from project order by updated_at desc"
        ))
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map([], row_to_project)
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}

pub fn get(state: &DbState, id: &str) -> Result<Option<Project>, AppError> {
    let conn = state.biz();
    conn.query_row(
        &format!("select {SELECT_COLUMNS} from project where id = ?1"),
        params![id],
        row_to_project,
    )
    .optional()
    .map_err(AppError::from)
}

pub fn create(state: &DbState, input: NewProject) -> Result<Project, AppError> {
    if input.title.trim().is_empty() {
        return Err(AppError::validation("作品标题不能为空"));
    }
    let conn = state.biz();
    let id = gen_id();
    conn.execute(
        r#"insert into project
           (id, title, genre, premise, audience, style, privacy, status, created_at, updated_at)
           values (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'idea', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))"#,
        params![
            id,
            input.title.trim(),
            input.genre,
            input.premise,
            input.audience,
            input.style,
            input.privacy
        ],
    )
    .map_err(AppError::from)?;
    drop(conn);
    get(state, &id)?.ok_or_else(|| AppError::internal("创建后读取失败"))
}

pub fn update(state: &DbState, project: &Project) -> Result<(), AppError> {
    let conn = state.biz();
    conn.execute(
        r#"update project set title=?2, genre=?3, premise=?4, audience=?5, style=?6,
           privacy=?7, status=?8, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           where id=?1"#,
        params![
            project.id,
            project.title,
            project.genre,
            project.premise,
            project.audience,
            project.style,
            project.privacy,
            project.status
        ],
    )
    .map_err(AppError::from)?;
    Ok(())
}

pub fn remove(state: &DbState, id: &str) -> Result<(), AppError> {
    // 先清向量索引：vec_rag 没有外键，project 一删就再也找不到那些 rowid，
    // 会留下永久残留的向量（rag_chunk 本身靠外键级联删除）。
    crate::services::rag::purge_project(state, id)?;
    let conn = state.biz();
    conn.execute("delete from project where id = ?1", params![id])
        .map_err(AppError::from)?;
    Ok(())
}

/// 作品是否设为「仅本地处理」。
///
/// 隐私判定必须由后端查库完成：前端传来的布尔值可以被任意脚本改成 false，
/// 那样「仅本地」作品就会把正文发到远端模型。作品不存在时按「不限制」处理，
/// 后续查询自己会报找不到数据。
pub fn is_local_only(state: &DbState, project_id: &str) -> Result<bool, AppError> {
    let conn = state.biz();
    let privacy: Option<String> = conn
        .query_row(
            "select privacy from project where id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    Ok(privacy.as_deref() == Some("local-only"))
}

/// 向量 upsert 骨架：P4 接入 embedding 后调用，先按 entity_id 去重。
#[allow(dead_code)]
pub fn upsert_fragment(state: &DbState, entity_id: &str, embedding: &[f32]) -> Result<(), AppError> {
    if embedding.len() != 768 {
        return Err(AppError::validation(format!(
            "向量维度必须为 768，收到 {}",
            embedding.len()
        )));
    }
    let conn = state.vec();
    let values = format!(
        "[{}]",
        embedding
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );
    conn.execute(
        "insert into vec_fragment(entity_id, embedding) values (?1, ?2)",
        params![entity_id, values],
    )
    .map_err(AppError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db;

    fn temp_state(tag: &str) -> (DbState, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("ih-p2-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = db::open(&dir).unwrap();
        (state, dir)
    }

    #[test]
    fn gen_id_is_unique_and_prefixed() {
        let a = gen_id();
        let b = gen_id();
        assert_ne!(a, b);
        assert!(a.starts_with("p-"));
    }

    #[test]
    fn create_list_get_update_delete_roundtrip() {
        let (state, dir) = temp_state("crud");
        let created = create(
            &state,
            NewProject {
                title: " 长篇小说 ".into(),
                genre: "科幻".into(),
                premise: "测试梗概".into(),
                audience: "".into(),
                style: "".into(),
                privacy: "local-only".into(),
            },
        )
        .unwrap();
        assert_eq!(created.title, "长篇小说", "标题应去除首尾空白");

        assert_eq!(list(&state).unwrap().len(), 1);
        let fetched = get(&state, &created.id).unwrap().unwrap();
        assert_eq!(fetched.privacy, "local-only");

        let mut updated = fetched;
        updated.status = "drafting".into();
        update(&state, &updated).unwrap();
        assert_eq!(
            get(&state, &updated.id).unwrap().unwrap().status,
            "drafting"
        );

        remove(&state, &created.id).unwrap();
        assert!(get(&state, &created.id).unwrap().is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn create_rejects_empty_title() {
        let (state, dir) = temp_state("empty");
        assert!(create(
            &state,
            NewProject {
                title: "   ".into(),
                genre: "".into(),
                premise: "".into(),
                audience: "".into(),
                style: "".into(),
                privacy: "any".into(),
            },
        )
        .is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn vec_upsert_validates_dimension() {
        let (state, dir) = temp_state("vec");
        assert!(upsert_fragment(&state, "e1", &[0.0; 768]).is_ok());
        assert!(upsert_fragment(&state, "e2", &[0.0; 3]).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
