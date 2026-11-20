//! Schema 迁移：版本化迁移步骤、Agent 表创建与补列辅助。
//! 从 db.rs 拆出，避免主文件超过项目单文件 500 行上限；
//! init_schema 仍在 db.rs（建表语句与连接初始化放一起更好找），迁移通过 super 调用。

use crate::error::AppError;
use rusqlite::Connection;

use super::init_schema;

/// 当前 schema 版本。每次改结构 +1，并在 [`migrate`] 里追加一段幂等步骤。
///
/// 3：修复「user_version 已到 2、`chapter.content_revision` 却没补上」的库。
/// 4：Agent 会话与运行轨迹——会话/消息/步骤三张表，支撑 Copilot 跨会话记忆与轨迹回放。
/// 5：Agent 消息记停止原因、步骤记模型——看板算成功率与成本折算要用。
pub(super) const SCHEMA_VERSION: i64 = 5;

/// 顺序迁移：从 `pragma user_version` 记录的位置往后执行。
///
/// 之前只有 `create table if not exists` + `ensure_column`，改列名、改类型、加约束都没地方落，
/// 而且新增列要同时改建表语句和补列语句，两处容易漂移。现在统一收在这里：
/// 版本号存在库里，升级路径可追溯；每步都写成幂等的，老库（user_version=0 但表已存在）
/// 也能安全地从第 1 步开始跑。
pub(super) fn migrate(conn: &Connection) -> Result<(), AppError> {
    let current: i64 = conn.query_row("pragma user_version", [], |row| row.get(0))?;
    if current >= SCHEMA_VERSION {
        return Ok(());
    }

    if current < 1 {
        init_schema(conn)?;
        // 老库的 chapter 表没有 act 列，建表语句的 if not exists 不会补列，需显式迁移。
        ensure_column(conn, "chapter", "act", "act integer not null default 1")?;
        // 写作台（P4）新增：章节正文与字数、版本快照的字数，老库同样需要补列。
        ensure_column(
            conn,
            "chapter",
            "content",
            "content text not null default ''",
        )?;
        ensure_column(
            conn,
            "chapter",
            "word_count",
            "word_count integer not null default 0",
        )?;
        ensure_column(
            conn,
            "draft_version",
            "word_count",
            "word_count integer not null default 0",
        )?;
        // P7 成本看板：agent_run 原来只有 tokens 总数，补两列分项，老库自动升级。
        ensure_column(
            conn,
            "agent_run",
            "prompt_tokens",
            "prompt_tokens integer not null default 0",
        )?;
        ensure_column(
            conn,
            "agent_run",
            "completion_tokens",
            "completion_tokens integer not null default 0",
        )?;
        conn.pragma_update(None, "user_version", 1)
            .map_err(AppError::from)?;
    }

    if current < 2 {
        // 正文独立的版本号：正文保存会 bump `updated_at`，而改标题/摘要/状态也会 bump，
        // 两者混用会让「改个标题」把写作台的保存基准顶掉。正文乐观锁只认这一列。
        ensure_column(
            conn,
            "chapter",
            "content_revision",
            "content_revision integer not null default 0",
        )?;
        // 版本号在「查询 max + 写入」之间没有互斥，多实例/异常重试会写出同章同号的快照，
        // 恢复历史时就会出现「两个第 3 版」。先按 (chapter_id, version) 去重保留最新写入，
        // 再建唯一索引，让数据库兜住后续并发。
        conn.execute_batch(
            r#"
            delete from draft_version
             where rowid not in (
                 select max(rowid) from draft_version group by chapter_id, version
             );
            create unique index if not exists idx_draft_version_unique
                on draft_version(chapter_id, version);
            "#,
        )
        .map_err(AppError::from)?;
        conn.pragma_update(None, "user_version", 2)
            .map_err(AppError::from)?;
    }

    if current < 3 {
        // 自愈步骤：曾有一版把 user_version 提到 2 却没真正补上 `chapter.content_revision`
        //（版本号先推进、补列后补），这类库的 `current < 2` 分支再也不会执行，
        // 打开写作台就报 `no such column: content_revision`。
        // 这里重跑一遍完全幂等的建表 + 补列 + 建唯一索引，不论版本号是否对得上都能补齐结构。
        init_schema(conn)?;
        backfill_columns(conn)?;
        conn.pragma_update(None, "user_version", 3)
            .map_err(AppError::from)?;
    }

    if current < 4 {
        // Agent 会话： Copilot 消息从组件内存移到库里，关闭应用后能续聊；
        // 步骤表记录每轮「思考→工具→观察」，供统计页回放与空转评估。
        create_agent_tables(conn)?;
        conn.pragma_update(None, "user_version", 4)
            .map_err(AppError::from)?;
    }

    if current < 5 {
        // 看板按停止原因算成功率、按模型折算成本：消息补 stop_reason，步骤补 model。
        ensure_column(
            conn,
            "agent_message",
            "stop_reason",
            "stop_reason text not null default ''",
        )?;
        ensure_column(
            conn,
            "agent_step",
            "model",
            "model text not null default ''",
        )?;
        conn.pragma_update(None, "user_version", 5)
            .map_err(AppError::from)?;
    }

    Ok(())
}

/// 建 Agent 会话相关表。单独抽出来是因为 init_schema 与新版本迁移都要调用，
/// 用 `if not exists` 保证任意残缺的旧库都能安全补齐。
fn create_agent_tables(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        r#"
        create table if not exists agent_session (
            id          text primary key,
            project_id  text not null references project(id) on delete cascade,
            title       text not null default '',
            created_at  text not null,
            updated_at  text not null
        );

        create table if not exists agent_message (
            id          text primary key,
            session_id  text not null references agent_session(id) on delete cascade,
            role        text not null,
            content     text not null default '',
            tool_calls  text not null default '',
            stop_reason text not null default '',
            created_at  text not null
        );

        create index if not exists idx_agent_message_session
            on agent_message(session_id, created_at);

        create table if not exists agent_step (
            id           text primary key,
            session_id   text not null references agent_session(id) on delete cascade,
            iteration    integer not null,
            tool_calls   text not null default '',
            observations text not null default '',
            tokens       integer not null default 0,
            latency_ms   integer not null default 0,
            model        text not null default '',
            created_at   text not null
        );

        create index if not exists idx_agent_step_session
            on agent_step(session_id, iteration);
        "#,
    )
    .map_err(AppError::from)
}

/// 幂等补齐「后加的列与派生索引」。
///
/// 与 v1/v2 分支里的补列内容重复是有意的：迁移必须能对任意残缺的旧库自愈，
/// 不能依赖 `user_version` 已经如实反映结构。新增列时除了在版本分支里加，
/// 也要在这里加一份，否则历史上版本号超前的库永远补不上。
fn backfill_columns(conn: &Connection) -> Result<(), AppError> {
    ensure_column(conn, "chapter", "act", "act integer not null default 1")?;
    ensure_column(
        conn,
        "chapter",
        "content",
        "content text not null default ''",
    )?;
    ensure_column(
        conn,
        "chapter",
        "word_count",
        "word_count integer not null default 0",
    )?;
    ensure_column(
        conn,
        "chapter",
        "content_revision",
        "content_revision integer not null default 0",
    )?;
    ensure_column(
        conn,
        "draft_version",
        "word_count",
        "word_count integer not null default 0",
    )?;
    ensure_column(
        conn,
        "agent_run",
        "prompt_tokens",
        "prompt_tokens integer not null default 0",
    )?;
    ensure_column(
        conn,
        "agent_run",
        "completion_tokens",
        "completion_tokens integer not null default 0",
    )?;
    // v5 的两列同样在这里留一份：版本号超前但结构没跟上的库靠 backfill 自愈。
    ensure_column(
        conn,
        "agent_message",
        "stop_reason",
        "stop_reason text not null default ''",
    )?;
    ensure_column(
        conn,
        "agent_step",
        "model",
        "model text not null default ''",
    )?;
    // 唯一索引前的去重同样要重跑：缺索引的库靠它兜住「同章同号快照」。
    conn.execute_batch(
        r#"
        delete from draft_version
         where rowid not in (
             select max(rowid) from draft_version group by chapter_id, version
         );
        create unique index if not exists idx_draft_version_unique
            on draft_version(chapter_id, version);
        "#,
    )
    .map_err(AppError::from)?;
    Ok(())
}

/// 轻量列迁移：仅当表已存在且缺列时执行 `alter table add column`。
/// SQLite 的 `create table if not exists` 不会给老表补列，升级时必须走这里。
pub(super) fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), AppError> {
    // pragma 对不存在的表返回空结果而不是报错，会误判成「缺列」，
    // 接着 alter 就会炸 no such table——backfill 在建表迁移之前跑就会踩到。
    let table_exists: bool = conn
        .query_row(
            "select exists(select 1 from sqlite_master where type = 'table' and name = ?1)",
            [table],
            |row| row.get(0),
        )
        .map_err(AppError::from)?;
    if !table_exists {
        return Ok(());
    }
    let mut stmt = conn
        .prepare(&format!("pragma table_info({table})"))
        .map_err(AppError::from)?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(AppError::from)?
        .filter_map(Result::ok)
        .any(|name| name == column);
    drop(stmt);
    if exists {
        return Ok(());
    }
    conn.execute_batch(&format!("alter table {table} add column {definition}"))
        .map_err(AppError::from)
}
