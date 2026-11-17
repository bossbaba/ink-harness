//! 数据库基础设施：应用数据目录下的单文件 SQLite。
//! 双连接：biz 承担业务 CRUD，vec 承担 sqlite-vec 向量表；共享同一文件，WAL 并发。

use std::path::PathBuf;
use std::sync::{Mutex, Once};

use rusqlite::{ffi::sqlite3_auto_extension, Connection, OptionalExtension};

/// 全局注册一次 sqlite-vec（进程级 auto extension，对所有连接生效）。
fn register_vec_once() {
    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute(
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

/// 在 app_data_dir 下打开（或创建）数据库并初始化 schema。
pub fn open(app_data_dir: &PathBuf) -> Result<DbState, String> {
    register_vec_once();
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let path = app_data_dir.join("ink-harness.db");

    let biz = Connection::open(&path).map_err(|e| e.to_string())?;
    let vec = Connection::open(&path).map_err(|e| e.to_string())?;

    for conn in [&biz, &vec] {
        conn.busy_timeout(std::time::Duration::from_secs(2))
            .map_err(|e| e.to_string())?;
        // 外键默认关闭；开启后 project 删除会级联清理章节/设定等子记录。
        conn.execute_batch("pragma journal_mode=WAL; pragma foreign_keys=ON;")
            .map_err(|e| e.to_string())?;
    }

    init_schema(&biz)?;
    // 老库的 chapter 表没有 act 列，建表语句的 if not exists 不会补列，需显式迁移。
    ensure_column(&biz, "chapter", "act", "act integer not null default 1")?;
    // 写作台（P4）新增：章节正文与字数、版本快照的字数，老库同样需要补列。
    ensure_column(&biz, "chapter", "content", "content text not null default ''")?;
    ensure_column(
        &biz,
        "chapter",
        "word_count",
        "word_count integer not null default 0",
    )?;
    ensure_column(
        &biz,
        "draft_version",
        "word_count",
        "word_count integer not null default 0",
    )?;
    seed_default_provider(&biz)?;
    init_vec_schema(&vec)?;

    Ok(DbState {
        biz: Mutex::new(biz),
        vec: Mutex::new(vec),
        path,
    })
}

fn init_schema(conn: &Connection) -> Result<(), String> {
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
    .map_err(|e| e.to_string())
}

/// 只种一次本地 Ollama 默认配置：用 app_meta 标记，避免用户删除后每次启动又冒出来。
fn seed_default_provider(conn: &Connection) -> Result<(), String> {
    let seeded: Option<String> = conn
        .query_row(
            "select value from app_meta where key = 'provider_seeded'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
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
    .map_err(|e| e.to_string())?;
    conn.execute(
        "insert or replace into app_meta(key, value) values ('provider_seeded', '1')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn init_vec_schema(conn: &Connection) -> Result<(), String> {
    // dimension 由使用方确定；先在 P2 建通用表，P4 接入 embedding 时按模型维度调整。
    conn.execute_batch(
        r#"
        create virtual table if not exists vec_fragment using vec0(
            entity_id text,
            embedding float[768]
        );
        "#,
    )
    .map_err(|e| e.to_string())
}

/// 轻量列迁移：仅当表已存在且缺列时执行 `alter table add column`。
/// SQLite 的 `create table if not exists` 不会给老表补列，升级时必须走这里。
fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("pragma table_info({table})"))
        .map_err(|e| e.to_string())?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .any(|name| name == column);
    drop(stmt);
    if exists {
        return Ok(());
    }
    conn.execute_batch(&format!("alter table {table} add column {definition}"))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::ensure_column;

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
}
