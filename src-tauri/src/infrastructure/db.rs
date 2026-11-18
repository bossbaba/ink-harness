//! 数据库基础设施：应用数据目录下的单文件 SQLite。
//! 双连接：biz 承担业务 CRUD，vec 承担 sqlite-vec 向量表；共享同一文件，WAL 并发。

use crate::error::AppError;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, Once};

use rusqlite::{ffi::sqlite3_auto_extension, params, Connection, OptionalExtension};

/// sqlite-vec 导出的初始化符号签名与 rusqlite 期望的不同，需转成 auto extension 要求的 C 函数指针。
type VecEntryPoint = unsafe extern "C" fn(
    *mut rusqlite::ffi::sqlite3,
    *mut *mut i8,
    *const rusqlite::ffi::sqlite3_api_routines,
) -> i32;

/// 全局注册一次 sqlite-vec（进程级 auto extension，对所有连接生效）。
fn register_vec_once() {
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute::<*const (), VecEntryPoint>(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    });
}

pub struct DbState {
    pub biz: Mutex<Connection>,
    pub vec: Mutex<Connection>,
    /// 数据库文件绝对路径，供前端展示/备份提示。
    pub path: PathBuf,
}

impl DbState {
    /// 取业务库连接。
    ///
    /// 锁中毒（某次持锁期间 panic）时继续使用内部数据，而不是把 PoisonError 往上抛：
    /// 否则一次 panic 之后，此后所有数据库命令都会返回「poisoned lock」，
    /// 用户只能重启应用。SQLite 连接是事务化的，未提交的事务已随 panic 回滚，继续用是安全的。
    pub fn biz(&self) -> MutexGuard<'_, Connection> {
        self.biz
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// 取向量库连接，语义同 [`DbState::biz`]。
    pub fn vec(&self) -> MutexGuard<'_, Connection> {
        self.vec
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// 在 app_data_dir 下打开（或创建）数据库并初始化 schema。
pub fn open(app_data_dir: &PathBuf) -> Result<DbState, AppError> {
    register_vec_once();
    std::fs::create_dir_all(app_data_dir).map_err(AppError::from)?;
    let path = app_data_dir.join("ink-harness.db");

    let biz = Connection::open(&path).map_err(AppError::from)?;
    let vec = Connection::open(&path).map_err(AppError::from)?;

    for conn in [&biz, &vec] {
        conn.busy_timeout(std::time::Duration::from_secs(2))
            .map_err(AppError::from)?;
        // 外键默认关闭；开启后 project 删除会级联清理章节/设定等子记录。
        conn.execute_batch("pragma journal_mode=WAL; pragma foreign_keys=ON;")
            .map_err(AppError::from)?;
    }

    migrate(&biz)?;
    // 老库里可能残留「来源已被删除」的索引片段（早期版本删章节不清理），启动时顺手清掉。
    purge_orphan_chunks(&biz, &vec)?;
    init_vec_schema(&vec)?;

    Ok(DbState {
        biz: Mutex::new(biz),
        vec: Mutex::new(vec),
        path,
    })
}

/// 当前 schema 版本。每次改结构 +1，并在 [`migrate`] 里追加一段幂等步骤。
const SCHEMA_VERSION: i64 = 1;

/// 顺序迁移：从 `pragma user_version` 记录的位置往后执行。
///
/// 之前只有 `create table if not exists` + `ensure_column`，改列名、改类型、加约束都没地方落，
/// 而且新增列要同时改建表语句和补列语句，两处容易漂移。现在统一收在这里：
/// 版本号存在库里，升级路径可追溯；每步都写成幂等的，老库（user_version=0 但表已存在）
/// 也能安全地从第 1 步开始跑。
fn migrate(conn: &Connection) -> Result<(), AppError> {
    let current: i64 = conn.query_row("pragma user_version", [], |row| row.get(0))?;
    if current >= SCHEMA_VERSION {
        return Ok(());
    }

    if current < 1 {
        init_schema(conn)?;
        // 老库的 chapter 表没有 act 列，建表语句的 if not exists 不会补列，需显式迁移。
        ensure_column(conn, "chapter", "act", "act integer not null default 1")?;
        // 写作台（P4）新增：章节正文与字数、版本快照的字数，老库同样需要补列。
        ensure_column(conn, "chapter", "content", "content text not null default ''")?;
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
        seed_default_provider(conn)?;
        conn.pragma_update(None, "user_version", 1)
            .map_err(AppError::from)?;
    }

    Ok(())
}

/// 清理孤儿索引片段：`rag_chunk.source_id` 没有外键，早期版本删章节/删设定条目时不清理，
/// 导致已删除的正文仍会被 RAG 当成参考资料检索出来。
///
/// 两条 anti-join 的代价在启动时可忽略；`vec_rag` 可能还没建（没做过 embedding），跳过即可。
fn purge_orphan_chunks(biz: &Connection, vec: &Connection) -> Result<(), AppError> {
    let ids: Vec<i64> = {
        let mut stmt = biz
            .prepare(
                "select id from rag_chunk
                 where (kind = 'chapter' and source_id not in (select id from chapter))
                    or (kind = 'element' and source_id not in (select id from story_element))
                    or kind not in ('chapter', 'element')",
            )
            .map_err(AppError::from)?;
        let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    if ids.is_empty() {
        return Ok(());
    }

    let has_vec: i64 = vec.query_row(
        "select count(*) from sqlite_master where name = 'vec_rag'",
        [],
        |row| row.get(0),
    )?;
    if has_vec > 0 {
        let mut stmt = vec
            .prepare("delete from vec_rag where rowid = ?1")
            .map_err(AppError::from)?;
        for id in &ids {
            stmt.execute(params![id]).map_err(AppError::from)?;
        }
    }

    let tx = biz.unchecked_transaction().map_err(AppError::from)?;
    let mut stmt = tx
        .prepare("delete from rag_chunk where id = ?1")
        .map_err(AppError::from)?;
    for id in &ids {
        stmt.execute(params![id]).map_err(AppError::from)?;
    }
    drop(stmt);
    tx.commit().map_err(AppError::from)?;
    eprintln!("已清理 {} 条孤儿索引片段（来源记录已不存在）", ids.len());
    Ok(())
}

fn init_schema(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        r#"
        create table if not exists project (
            id          text primary key,
            title       text not null,
            genre       text not null default '',
            premise     text not null default '',
            audience    text not null default '',
            style       text not null default '',
            privacy     text not null default 'any',   -- any | local-only
            status      text not null default 'idea',  -- idea/outline/drafting/review/published
            created_at  text not null,
            updated_at  text not null
        );

        create table if not exists chapter (
            id          text primary key,
            project_id  text not null references project(id) on delete cascade,
            act         integer not null default 1,   -- 1/2/3 对应三幕
            title       text not null,
            sort_order  integer not null default 0,
            summary     text not null default '',
            status      text not null default 'planned',
            content     text not null default '',     -- TipTap 文档 JSON，列表查询不读这一列
            word_count  integer not null default 0,   -- 正文非空白字符数，列表页直接显示
            created_at  text not null,
            updated_at  text not null
        );
        create index if not exists idx_chapter_project on chapter(project_id, sort_order);

        create table if not exists scene (
            id          text primary key,
            chapter_id  text not null references chapter(id) on delete cascade,
            title       text not null default '',
            sort_order  integer not null default 0,
            pov         text not null default '',
            location    text not null default '',
            time_mark   text not null default '',
            summary     text not null default ''
        );
        create index if not exists idx_scene_chapter on scene(chapter_id, sort_order);

        create table if not exists story_element (
            id          text primary key,
            project_id  text not null references project(id) on delete cascade,
            kind        text not null,   -- character | place | org | term | event
            name        text not null,
            summary     text not null default '',
            detail_json text not null default '{}',
            created_at  text not null,
            updated_at  text not null
        );
        create index if not exists idx_element_project_kind on story_element(project_id, kind);

        create table if not exists draft_version (
            id          text primary key,
            chapter_id  text not null references chapter(id) on delete cascade,
            content     text not null default '',
            word_count  integer not null default 0,
            version     integer not null,
            created_at  text not null
        );
        create index if not exists idx_draft_chapter on draft_version(chapter_id, version);

        create table if not exists foreshadow (
            id               text primary key,
            project_id       text not null references project(id) on delete cascade,
            title            text not null,
            setup_chapter_id text,
            payoff_chapter_id text,
            status           text not null default 'planned'
        );

        create table if not exists agent_run (
            id            text primary key,
            project_id    text not null references project(id) on delete cascade,
            task_kind     text not null,
            model         text not null,
            input_summary text not null default '',
            output        text not null default '',
            tokens        integer not null default 0,
            created_at    text not null
        );

        -- 应用级键值元数据：目前记录一次性种子是否已执行。
        create table if not exists app_meta (
            key   text primary key,
            value text not null
        );

        -- RAG 片段：正文与来源存在业务库，向量存在 vec_rag（rowid 与本表 id 对应）。
        -- vec_rag 的维度由 embedding 模型决定，建表放在 services/rag.rs 里动态处理。
        create table if not exists rag_chunk (
            id          integer primary key autoincrement,
            project_id  text not null references project(id) on delete cascade,
            kind        text not null,             -- element | chapter
            source_id   text not null,             -- story_element.id 或 chapter.id
            title       text not null default '',
            content     text not null,
            indexed_at  text not null
        );
        create index if not exists idx_rag_chunk_project on rag_chunk(project_id, kind);

        -- Provider 配置落库，避免重启后模型管理页的设置全部丢失。
        -- models_json 存 ProviderModel 数组（id/displayName/contextWindow/costPer1kTokens）。
        create table if not exists provider_config (
            id          text primary key,
            name        text not null,
            source      text not null default 'local',   -- local | remote
            base_url    text not null,
            api_key_ref text,
            enabled     integer not null default 1,
            models_json text not null default '[]',
            updated_at  text not null
        );
        "#,
    )
    .map_err(AppError::from)
}

/// 只种一次本地 Ollama 默认配置：用 app_meta 标记，避免用户删除后每次启动又冒出来。
fn seed_default_provider(conn: &Connection) -> Result<(), AppError> {
    let seeded: Option<String> = conn
        .query_row(
            "select value from app_meta where key = 'provider_seeded'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::from)?;
    if seeded.is_some() {
        return Ok(());
    }

    conn.execute(
        r#"insert or ignore into provider_config
           (id, name, source, base_url, api_key_ref, enabled, models_json, updated_at)
           values ('ollama-local', '本地 Ollama', 'local',
                   'http://localhost:11434/v1', null, 1, '[]',
                   strftime('%Y-%m-%dT%H:%M:%fZ','now'))"#,
        [],
    )
    .map_err(AppError::from)?;
    conn.execute(
        "insert or replace into app_meta(key, value) values ('provider_seeded', '1')",
        [],
    )
    .map_err(AppError::from)?;
    Ok(())
}

fn init_vec_schema(conn: &Connection) -> Result<(), AppError> {
    // dimension 由使用方确定；先在 P2 建通用表，P4 接入 embedding 时按模型维度调整。
    conn.execute_batch(
        r#"
        create virtual table if not exists vec_fragment using vec0(
            entity_id text,
            embedding float[768]
        );
        "#,
    )
    .map_err(AppError::from)
}

/// 轻量列迁移：仅当表已存在且缺列时执行 `alter table add column`。
/// SQLite 的 `create table if not exists` 不会给老表补列，升级时必须走这里。
fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), AppError> {
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

#[cfg(test)]
mod tests {
    use super::{ensure_column, migrate, purge_orphan_chunks};
    use rusqlite::Connection;

    /// 老库的 chapter 表没有 act 列，迁移必须补上，且重复执行保持幂等。
    #[test]
    fn ensure_column_migrates_legacy_chapter_table() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "create table chapter (
                id text primary key,
                project_id text not null,
                title text not null,
                sort_order integer not null default 0,
                summary text not null default '',
                status text not null default 'planned',
                created_at text not null,
                updated_at text not null
            );",
        )
        .unwrap();

        ensure_column(&conn, "chapter", "act", "act integer not null default 1").unwrap();
        ensure_column(&conn, "chapter", "act", "act integer not null default 1").unwrap();

        let count: i64 = conn
            .query_row(
                "select count(*) from pragma_table_info('chapter') where name = 'act'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    /// 迁移要把版本号写进库，且重复执行保持幂等（老库从 0 升到当前版本）。
    #[test]
    fn migrate_records_schema_version_and_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let version: i64 = conn
            .query_row("pragma user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);

        migrate(&conn).unwrap();
        let again: i64 = conn
            .query_row("pragma user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(again, 1);
    }

    /// 来源已被删除的片段属于孤儿数据，启动时要清掉，否则删掉的正文还能被检索出来。
    #[test]
    fn purge_orphan_chunks_drops_chunks_without_source() {
        let biz = Connection::open_in_memory().unwrap();
        let vec = Connection::open_in_memory().unwrap();
        migrate(&biz).unwrap();
        biz.execute(
            "insert into project (id, title, created_at, updated_at) values ('p', 't', 'x', 'x')",
            [],
        )
        .unwrap();
        biz.execute(
            "insert into story_element (id, project_id, kind, name, detail_json, created_at, updated_at)
             values ('el', 'p', 'character', 'a', '{}', 'x', 'x')",
            [],
        )
        .unwrap();
        for source in ["el", "gone"] {
            biz.execute(
                "insert into rag_chunk (project_id, kind, source_id, title, content, indexed_at)
                 values ('p', 'element', ?1, 'a', 'x', 'x')",
                rusqlite::params![source],
            )
            .unwrap();
        }

        purge_orphan_chunks(&biz, &vec).unwrap();

        let left: i64 = biz
            .query_row("select count(*) from rag_chunk", [], |row| row.get(0))
            .unwrap();
        assert_eq!(left, 1, "只保留来源仍存在的片段");
    }
}
