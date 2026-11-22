//! Agent 评测结果持久化。
//!
//! 评测本身在前端跑（Agent Loop 在 service 层），这里只负责把一次跑分的
//! 汇总与逐例明细存下来，供「历史对比」与失败用例定位。逐例明细用 JSON 存，
//! 不建子表：结构随用例演进，读的时候整体解析反而更省事。

use rusqlite::params;

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::infrastructure::id::gen_id;
use crate::models::{AgentEvalRun, NewAgentEvalRun};

/// 时间戳 SQL 片段，与其它 Agent 表同口径。
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const ROW: &str = "select id, project_id, role_id, role_name, model, total, passed,
                          rounds, tokens, duration_ms, details, created_at
                     from agent_eval_run";

/// 写入一次跑分结果，返回落库后的完整记录（含后端生成的 id 与时间）。
///
/// 注意 `DbState::biz()` 返回的是不可重入的 `MutexGuard`：这里若一直持有连接再去调
/// `get_run()`（它内部也会取锁），同线程会直接把 `cargo test` 与真实请求卡死。
/// 所以写入用独立作用域，写完先释放锁再读回。
pub fn save_run(state: &DbState, input: &NewAgentEvalRun) -> Result<AgentEvalRun, AppError> {
    let id = gen_id("eval");
    {
        let conn = state.biz();
        let sql = format!(
            "insert into agent_eval_run
                 (id, project_id, role_id, role_name, model, total, passed, rounds, tokens,
                  duration_ms, details, created_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, {NOW})"
        );
        conn.execute(
            &sql,
            params![
                id,
                input.project_id,
                input.role_id,
                input.role_name,
                input.model,
                input.total,
                input.passed,
                input.rounds,
                input.tokens,
                input.duration_ms,
                input.details,
            ],
        )
        .map_err(AppError::from)?;
    }
    get_run(state, &id)?.ok_or_else(|| AppError::internal("评测写入后读取失败"))
}

/// 按 id 取一次跑分；细节字段原样返回字符串，解析交给前端。
pub fn get_run(state: &DbState, id: &str) -> Result<Option<AgentEvalRun>, AppError> {
    use rusqlite::OptionalExtension;
    let conn = state.biz();
    let sql = format!("{ROW} where id = ?1");
    conn.query_row(&sql, params![id], map_row)
        .optional()
        .map_err(AppError::from)
}

/// 最近的跑分，新的在前。limit 为 0 时取 20 条：页面只看近期趋势，不需要全量。
pub fn list_runs(state: &DbState, limit: i64) -> Result<Vec<AgentEvalRun>, AppError> {
    let conn = state.biz();
    let limit = if limit <= 0 { 20 } else { limit.min(200) };
    let sql = format!("{ROW} order by created_at desc limit ?1");
    let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![limit], map_row)
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// 列 → 结构体，三处查询共用，避免字段顺序漂移。
fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentEvalRun> {
    Ok(AgentEvalRun {
        id: row.get(0)?,
        project_id: row.get(1)?,
        role_id: row.get(2)?,
        role_name: row.get(3)?,
        model: row.get(4)?,
        total: row.get(5)?,
        passed: row.get(6)?,
        rounds: row.get(7)?,
        tokens: row.get(8)?,
        duration_ms: row.get(9)?,
        details: row.get(10)?,
        created_at: row.get(11)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db::open;

    fn temp_state() -> (DbState, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("ink-agent-eval-test-{}", gen_id("d")));
        std::fs::create_dir_all(&dir).unwrap();
        (open(&dir).unwrap(), dir)
    }

    #[test]
    fn save_and_list_runs() {
        let (state, dir) = temp_state();
        let saved = save_run(
            &state,
            &NewAgentEvalRun {
                project_id: "p1".into(),
                role_id: "r1".into(),
                role_name: "写作助手".into(),
                model: "ollama-local:qwen3.5:4b".into(),
                total: 5,
                passed: 4,
                rounds: 9,
                tokens: 1200,
                duration_ms: 8000,
                details: r#"[{"caseId":"c1","ok":true}]"#.into(),
            },
        )
        .unwrap();
        assert_eq!(saved.total, 5);
        assert_eq!(saved.passed, 4);
        assert!(!saved.created_at.is_empty(), "created_at 应由数据库写入");

        let runs = list_runs(&state, 0).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].role_name, "写作助手");
        assert!(get_run(&state, &saved.id).unwrap().is_some());
        std::fs::remove_dir_all(&dir).ok();
    }
}
