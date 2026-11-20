//! Agent 角色持久化：prompt + 工具白名单。
//!
//! 角色不绑定模型——选哪个模型仍由任务路由决定；这里只回答
//! 「用什么身份说话、允许它调哪些工具」，便于同一套模型配置下切换写作/审稿等身份。

use rusqlite::params;

use crate::error::AppError;
use crate::infrastructure::db::DbState;
use crate::infrastructure::id::gen_id;
use crate::models::{AgentRole, NewAgentRole};

/// 时间戳 SQL 片段，与其它 Agent 表同口径（SQLite 生成 UTC 毫秒）。
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/// 列出全部角色，按名称排序：数量不大，界面一次拉全量即可。
pub fn list_roles(state: &DbState) -> Result<Vec<AgentRole>, AppError> {
    let conn = state.biz();
    let mut stmt = conn
        .prepare(
            "select id, name, prompt, tools, created_at, updated_at
               from agent_role order by name asc",
        )
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(AgentRole {
                id: row.get(0)?,
                name: row.get(1)?,
                prompt: row.get(2)?,
                tools: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(AppError::from)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

/// 新建或更新角色：id 为空走插入，否则按 id 更新。
/// 名称是唯一可读标识，允许重名（作者可能有多套「审稿」prompt 做对比），不做唯一约束。
pub fn save_role(state: &DbState, input: &NewAgentRole) -> Result<AgentRole, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::validation("角色名称不能为空"));
    }
    let conn = state.biz();
    if input.id.trim().is_empty() {
        let id = gen_id("role");
        let sql = format!(
            "insert into agent_role(id, name, prompt, tools, created_at, updated_at)
             values (?1, ?2, ?3, ?4, {NOW}, {NOW})"
        );
        conn.execute(&sql, params![id, name, input.prompt, input.tools])
            .map_err(AppError::from)?;
        return get_role(state, &id)?.ok_or_else(|| AppError::internal("角色写入后读取失败"));
    }

    let sql = format!(
        "update agent_role set name = ?2, prompt = ?3, tools = ?4, updated_at = {NOW}
          where id = ?1"
    );
    conn.execute(
        &sql,
        params![input.id, name, input.prompt, input.tools],
    )
    .map_err(AppError::from)?;
    get_role(state, &input.id)?.ok_or_else(|| AppError::validation("要更新的角色不存在"))
}

/// 按 id 取角色；不存在返回 None，由调用方决定提示还是忽略。
pub fn get_role(state: &DbState, id: &str) -> Result<Option<AgentRole>, AppError> {
    use rusqlite::OptionalExtension;
    let conn = state.biz();
    conn.query_row(
        "select id, name, prompt, tools, created_at, updated_at from agent_role where id = ?1",
        params![id],
        |row| {
            Ok(AgentRole {
                id: row.get(0)?,
                name: row.get(1)?,
                prompt: row.get(2)?,
                tools: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(AppError::from)
}

/// 删除角色：历史会话与评测记录保留 role_name 快照，不因删角色丢上下文。
pub fn delete_role(state: &DbState, id: &str) -> Result<(), AppError> {
    let conn = state.biz();
    conn.execute("delete from agent_role where id = ?1", params![id])
        .map_err(AppError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db::open;

    fn temp_state() -> (DbState, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("ink-agent-role-test-{}", gen_id("d")));
        std::fs::create_dir_all(&dir).unwrap();
        (open(&dir).unwrap(), dir)
    }

    #[test]
    fn role_crud_roundtrip() {
        let (state, dir) = temp_state();
        let created = save_role(
            &state,
            &NewAgentRole {
                id: String::new(),
                name: "  审稿编辑 ".into(),
                prompt: "只挑硬伤".into(),
                tools: r#"["read_chapter"]"#.into(),
            },
        )
        .unwrap();
        // 名称去空格：界面上不会出现前后空白，便于查找。
        assert_eq!(created.name, "审稿编辑");
        assert_eq!(list_roles(&state).unwrap().len(), 1);

        let updated = save_role(
            &state,
            &NewAgentRole {
                id: created.id.clone(),
                name: "审稿编辑".into(),
                prompt: "只挑硬伤，按严重程度排序".into(),
                tools: String::new(),
            },
        )
        .unwrap();
        assert!(updated.prompt.contains("严重程度"));
        // 空 tools 表示全部工具，前端会据此放开所有工具。
        assert!(updated.tools.is_empty());

        delete_role(&state, &created.id).unwrap();
        assert!(get_role(&state, &created.id).unwrap().is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn empty_name_is_rejected() {
        let (state, dir) = temp_state();
        let err = save_role(
            &state,
            &NewAgentRole {
                id: String::new(),
                name: "   ".into(),
                prompt: String::new(),
                tools: String::new(),
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("角色名称"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
