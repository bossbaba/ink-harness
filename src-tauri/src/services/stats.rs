//! 全局统计：跨作品汇总作品/章节/字数/设定等，给一级路由的只读看板用。
//! 全部走同一条连接、几次 count/group by 查询，避免按作品逐个拉再在前端算。
use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::models::{CountItem, WorkspaceStats};

fn scalar(conn: &rusqlite::Connection, sql: &str) -> Result<i64, AppError> {
    conn.query_row(sql, [], |row| row.get::<_, i64>(0))
        .map_err(AppError::from)
}

fn grouped(
    conn: &rusqlite::Connection,
    sql: &str,
) -> Result<Vec<CountItem>, AppError> {
    let mut stmt = conn.prepare(sql).map_err(AppError::from)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CountItem {
                key: row.get::<_, String>(0)?,
                count: row.get::<_, i64>(1)?,
            })
        })
        .map_err(AppError::from)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(AppError::from)?);
    }
    Ok(out)
}

/// 一次汇总；所有表都可能为空，count/sum 在空表上返回 0，这里用 coalesce 兜住 sum 的 NULL。
pub fn workspace_stats(state: &DbState) -> Result<WorkspaceStats, AppError> {
    let conn = state.biz();
    Ok(WorkspaceStats {
        projects: scalar(&conn, "select count(*) from project")?,
        chapters: scalar(&conn, "select count(*) from chapter")?,
        total_words: scalar(
            &conn,
            "select coalesce(sum(word_count), 0) from chapter",
        )?,
        story_elements: scalar(&conn, "select count(*) from story_element")?,
        scenes: scalar(&conn, "select count(*) from scene")?,
        foreshadows: scalar(&conn, "select count(*) from foreshadow")?,
        projects_by_status: grouped(
            &conn,
            "select status as key, count(*) as count from project group by status order by count desc",
        )?,
        chapters_by_status: grouped(
            &conn,
            "select status as key, count(*) as count from chapter group by status order by count desc",
        )?,
        elements_by_kind: grouped(
            &conn,
            "select kind as key, count(*) as count from story_element group by kind order by count desc",
        )?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed() -> DbState {
        let dir = std::env::temp_dir().join(format!(
            "ink-harness-stats-test-{}",
            gen_suffix()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let state = crate::infrastructure::db::open(&dir).unwrap();
        {
            let conn = state.biz();
            conn.execute_batch(
                "insert into project (id,title,status,created_at,updated_at) values ('p1','甲','drafting','','');
                 insert into project (id,title,status,created_at,updated_at) values ('p2','乙','idea','','');
                 insert into chapter (id,project_id,title,word_count,status,created_at,updated_at) values ('c1','p1','第一章',120,'done','','');
                 insert into chapter (id,project_id,title,word_count,status,created_at,updated_at) values ('c2','p1','第二章',80,'planned','','');
                 insert into story_element (id,project_id,kind,name,created_at,updated_at) values ('e1','p1','character','主角','','');
                 insert into scene (id,chapter_id,title) values ('s1','c1','场景一');
                 insert into foreshadow (id,project_id,title) values ('f1','p1','伏笔一');",
            )
            .unwrap();
        }
        state
    }

    fn gen_suffix() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        format!("{}-{}", std::process::id(), nanos)
    }

    #[test]
    fn workspace_stats_aggregates_all_projects() {
        let state = seed();
        let stats = workspace_stats(&state).unwrap();
        assert_eq!(stats.projects, 2);
        assert_eq!(stats.chapters, 2);
        assert_eq!(stats.total_words, 200);
        assert_eq!(stats.story_elements, 1);
        assert_eq!(stats.scenes, 1);
        assert_eq!(stats.foreshadows, 1);
        let drafting = stats.projects_by_status.iter().find(|i| i.key == "drafting").unwrap();
        assert_eq!(drafting.count, 1);
        let done = stats.chapters_by_status.iter().find(|i| i.key == "done").unwrap();
        assert_eq!(done.count, 1);
        let character = stats.elements_by_kind.iter().find(|i| i.key == "character").unwrap();
        assert_eq!(character.count, 1);
    }

    #[test]
    fn workspace_stats_empty_db_is_zero() {
        let dir = std::env::temp_dir().join(format!("ink-harness-stats-empty-{}", gen_suffix()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let state = crate::infrastructure::db::open(&dir).unwrap();
        let stats = workspace_stats(&state).unwrap();
        assert_eq!(stats.projects, 0);
        assert_eq!(stats.total_words, 0);
        assert!(stats.projects_by_status.is_empty());
    }
}
