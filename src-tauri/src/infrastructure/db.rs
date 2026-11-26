//! 数据库基础设施：应用数据目录下的单文件 SQLite。
//! 双连接：biz 承担业务 CRUD，vec 承担 sqlite-vec 向量表；共享同一文件，WAL 并发。

use crate::error::AppError;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, Once};

use rusqlite::{Connection, ffi::sqlite3_auto_extension, params};

mod schema;
mod vector_tables;
use schema::migrate;
pub(crate) use vector_tables::delete_vec_rows;
// 只有 rag 的边界测试需要直接枚举向量表名；非测试构建不导出，避免 unused_imports 警告。
#[cfg(test)]
pub(crate) use vector_tables::all_vec_table_names;

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

    // 按维度分表后向量散落在 vec_rag_{dim} 里，只清旧表会留下幽灵向量：
    // 既占空间，又会在 KNN 里挤掉有效候选。
    delete_vec_rows(vec, &ids)?;

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
            content_revision integer not null default 0, -- 正文保存计数，正文乐观锁专用
            meta_revision integer not null default 0,    -- 大纲元数据计数，改标题/幕次专用
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


#[cfg(test)]
mod tests;
