//! 数据库基础设施：应用数据目录下的单文件 SQLite。
//! 双连接：biz 承担业务 CRUD，vec 承担 sqlite-vec 向量表；共享同一文件，WAL 并发。

use std::path::PathBuf;
use std::sync::{Mutex, Once};

use rusqlite::{ffi::sqlite3_auto_extension, Connection};

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
            title       text not null,
            sort_order  integer not null default 0,
            summary     text not null default '',
            status      text not null default 'planned',
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
        "#,
    )
    .map_err(|e| e.to_string())
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
