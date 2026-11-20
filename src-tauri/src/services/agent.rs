//! Agent 会话与轨迹的持久化。
//! 不依赖 Tauri 类型，只操作业务库，便于纯 Rust 单测；命令层负责异步包装。

use rusqlite::{OptionalExtension, params};

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::infrastructure::id::gen_id;
use crate::models::{
    AgentMessage, AgentOutcomeStats, AgentSession, AgentStepRecord, NewAgentMessage,
    NewAgentSession, NewAgentStep,
};

/// 时间戳 SQL 片段，与 agent_run 同口径（SQLite 生成 UTC 毫秒），便于按时间排序。
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/// 新建会话，返回落库后的会话（含生成 id）。
pub fn create_session(state: &DbState, input: &NewAgentSession) -> Result<AgentSession, AppError> {
    let conn = state.biz();
    let id = gen_id("sess");
    let title = if input.title.trim().is_empty() {
        "新对话"
    } else {
        input.title.trim()
    };
    let sql = format!(
        "insert into agent_session(id, project_id, title, created_at, updated_at)
         values (?1, ?2, ?3, {NOW}, {NOW})"
    );
    conn.execute(&sql, params![id, input.project_id, title])
        .map_err(AppError::from)?;
    Ok(AgentSession {
        id,
        project_id: input.project_id.clone(),
        title: title.to_string(),
        created_at: String::new(),
        updated_at: String::new(),
    })
}

/// 列出会话，按更新时间倒序。project_id 为空串时列出全部（全局看板用）。
pub fn list_sessions(state: &DbState, project_id: &str) -> Result<Vec<AgentSession>, AppError> {
    let conn = state.biz();
    let (sql, params_ref): (&str, Vec<&str>) = if project_id.is_empty() {
        (
            "select id, project_id, title, created_at, updated_at
               from agent_session order by updated_at desc",
            Vec::new(),
        )
    } else {
        (
            "select id, project_id, title, created_at, updated_at
               from agent_session where project_id = ?1 order by updated_at desc",
            vec![project_id],
        )
    };
    let mut stmt = conn.prepare(sql).map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params_ref.iter()), |row| {
            Ok(AgentSession {
                id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// 重命名会话：只改标题，不动消息与轨迹。
/// 空标题按「未命名对话」落库，避免列表里出现一行空白、点不开也认不出。
pub fn rename_session(state: &DbState, id: &str, title: &str) -> Result<(), AppError> {
    let conn = state.biz();
    let title = if title.trim().is_empty() {
        "未命名对话"
    } else {
        title.trim()
    };
    let sql = format!("update agent_session set title = ?2, updated_at = {NOW} where id = ?1");
    conn.execute(&sql, params![id, title])
        .map_err(AppError::from)?;
    Ok(())
}

/// 删除会话：连同消息与轨迹一起删。
/// 虽然外键声明了 on delete cascade，但级联依赖连接上的 `foreign_keys` pragma，
/// 老库或临时连接可能没开——显式删子表更稳，也不会留下孤儿轨迹。
pub fn delete_session(state: &DbState, id: &str) -> Result<(), AppError> {
    let conn = state.biz();
    conn.execute("delete from agent_step where session_id = ?1", params![id])
        .map_err(AppError::from)?;
    conn.execute(
        "delete from agent_message where session_id = ?1",
        params![id],
    )
    .map_err(AppError::from)?;
    conn.execute("delete from agent_session where id = ?1", params![id])
        .map_err(AppError::from)?;
    Ok(())
}

/// 追加一条消息，并顺带更新会话的 updated_at（列表按它排序）。
pub fn append_message(state: &DbState, input: &NewAgentMessage) -> Result<(), AppError> {
    let conn = state.biz();
    let sql = format!(
        "insert into agent_message(id, session_id, role, content, tool_calls, stop_reason, created_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, {NOW})"
    );
    conn.execute(
        &sql,
        params![
            input.id,
            input.session_id,
            input.role,
            input.content,
            input.tool_calls,
            input.stop_reason
        ],
    )
    .map_err(AppError::from)?;
    touch_session(&conn, &input.session_id)?;
    Ok(())
}

/// 读取一个会话的全部消息，按时间正序。
pub fn list_messages(state: &DbState, session_id: &str) -> Result<Vec<AgentMessage>, AppError> {
    let conn = state.biz();
    let mut stmt = conn
        .prepare(
            "select id, session_id, role, content, tool_calls, stop_reason, created_at
               from agent_message where session_id = ?1 order by created_at asc, rowid asc",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map(params![session_id], |row| {
            Ok(AgentMessage {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                tool_calls: row.get(4)?,
                stop_reason: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// 追加一步轨迹。会话不存在时静默跳过（消息先落库、轨迹后写，中途关闭应用的竞态）。
pub fn append_step(state: &DbState, input: &NewAgentStep) -> Result<(), AppError> {
    let conn = state.biz();
    let exists: Option<i64> = conn
        .query_row(
            "select 1 from agent_session where id = ?1",
            params![input.session_id],
            |_| Ok(1),
        )
        .optional()
        .map_err(AppError::from)?;
    if exists.is_none() {
        return Ok(());
    }
    let sql = format!(
        "insert into agent_step(id, session_id, iteration, tool_calls, observations, tokens, latency_ms, model, created_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, {NOW})"
    );
    conn.execute(
        &sql,
        params![
            gen_id("step"),
            input.session_id,
            input.iteration,
            input.tool_calls,
            input.observations,
            input.tokens,
            input.latency_ms,
            input.model
        ],
    )
    .map_err(AppError::from)?;
    Ok(())
}

/// 列出轨迹，按会话与轮次排序，供看板回放。
/// project_id 为空串时列出全部作品（全局统计页用），否则只看该作品。
pub fn list_steps(state: &DbState, project_id: &str) -> Result<Vec<AgentStepRecord>, AppError> {
    let conn = state.biz();
    const ROW: &str = "select s.id, s.session_id, s.iteration, s.tool_calls, s.observations,
                              s.tokens, s.latency_ms, s.model, s.created_at
                         from agent_step s
                         join agent_session sess on sess.id = s.session_id";
    let (sql, params_ref): (&str, Vec<&str>) = if project_id.is_empty() {
        (ROW, Vec::new())
    } else {
        (
            "select s.id, s.session_id, s.iteration, s.tool_calls, s.observations,
                    s.tokens, s.latency_ms, s.model, s.created_at
               from agent_step s
               join agent_session sess on sess.id = s.session_id
              where sess.project_id = ?1",
            vec![project_id],
        )
    };
    let sql = format!("{sql} order by s.created_at asc, s.iteration asc");
    let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params_ref.iter()), |row| {
            Ok(AgentStepRecord {
                id: row.get(0)?,
                session_id: row.get(1)?,
                iteration: row.get(2)?,
                tool_calls: row.get(3)?,
                observations: row.get(4)?,
                tokens: row.get(5)?,
                latency_ms: row.get(6)?,
                model: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// 按停止原因统计已完成的循环次数，看板用它算成功率。
/// 只数 `role=assistant` 且 stop_reason 非空的行：普通聊天与半途中止的消息不计入分母。
pub fn outcome_stats(state: &DbState) -> Result<AgentOutcomeStats, AppError> {
    let conn = state.biz();
    let mut stats = AgentOutcomeStats::default();
    let mut stmt = conn
        .prepare(
            "select stop_reason, count(*) from agent_message
              where role = 'assistant' and stop_reason != ''
              group by stop_reason",
        )
        .map_err(AppError::from)?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (reason, count) = row.map_err(AppError::from)?;
        stats.runs += count;
        match reason.as_str() {
            "no-tools" => stats.succeeded += count,
            "max-iterations" => stats.max_iterations += count,
            "idle-loop" => stats.idle += count,
            "error" => stats.errors += count,
            // 未知原因只计入总数不归类：以后新增枚举不会被误算成失败。
            _ => {}
        }
    }
    Ok(stats)
}

/// 更新会话的最后活跃时间。
fn touch_session(conn: &rusqlite::Connection, session_id: &str) -> Result<(), AppError> {
    let sql = format!("update agent_session set updated_at = {NOW} where id = ?1");
    conn.execute(&sql, params![session_id])
        .map_err(AppError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db::open;

    fn temp_state() -> (DbState, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("ink-agent-test-{}", gen_id("d")));
        std::fs::create_dir_all(&dir).unwrap();
        (open(&dir).unwrap(), dir)
    }

    #[test]
    fn session_message_and_step_roundtrip() {
        let (state, dir) = temp_state();
        // agent_session.project_id 是外键，先建一条作品。
        state
            .biz()
            .execute(
                "insert into project (id, title, created_at, updated_at) values ('p1', '测试作品', 't', 't')",
                [],
            )
            .unwrap();
        let session = create_session(
            &state,
            &NewAgentSession {
                project_id: "p1".into(),
                title: String::new(),
            },
        )
        .unwrap();
        assert_eq!(session.title, "新对话");

        append_message(
            &state,
            &NewAgentMessage {
                id: "m1".into(),
                session_id: session.id.clone(),
                role: "user".into(),
                content: "检查第三章".into(),
                tool_calls: String::new(),
                stop_reason: String::new(),
            },
        )
        .unwrap();
        append_message(
            &state,
            &NewAgentMessage {
                id: "m2".into(),
                session_id: session.id.clone(),
                role: "assistant".into(),
                content: "第三章有三处问题".into(),
                tool_calls: String::new(),
                stop_reason: "no-tools".into(),
            },
        )
        .unwrap();
        let messages = list_messages(&state, &session.id).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].content, "检查第三章");
        assert_eq!(messages[1].stop_reason, "no-tools");

        append_step(
            &state,
            &NewAgentStep {
                session_id: session.id.clone(),
                iteration: 1,
                tool_calls: "[]".into(),
                observations: "[]".into(),
                tokens: 100,
                latency_ms: 250,
                model: "ollama-local:qwen3.5:4b".into(),
            },
        )
        .unwrap();
        let steps = list_steps(&state, "p1").unwrap();
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].tokens, 100);
        assert_eq!(steps[0].model, "ollama-local:qwen3.5:4b");

        // 成功率聚合：两次 no-tools + 一次 idle-loop 应分别归类。
        append_message(
            &state,
            &NewAgentMessage {
                id: "m3".into(),
                session_id: session.id.clone(),
                role: "assistant".into(),
                content: "重复调用被掐停".into(),
                tool_calls: String::new(),
                stop_reason: "idle-loop".into(),
            },
        )
        .unwrap();
        append_message(
            &state,
            &NewAgentMessage {
                id: "m4".into(),
                session_id: session.id.clone(),
                role: "assistant".into(),
                content: "又答完一次".into(),
                tool_calls: String::new(),
                stop_reason: "no-tools".into(),
            },
        )
        .unwrap();
        let stats = outcome_stats(&state).unwrap();
        assert_eq!(stats.runs, 3);
        assert_eq!(stats.succeeded, 2);
        assert_eq!(stats.idle, 1);
        assert_eq!(stats.errors, 0);

        let sessions = list_sessions(&state, "p1").unwrap();
        assert_eq!(sessions.len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }
}
