//! 数据库迁移与启动清理的单测。

use super::purge_orphan_chunks;
use super::schema::{ensure_column, migrate, SCHEMA_VERSION};
use super::init_schema;
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
    assert_eq!(version, SCHEMA_VERSION);

    migrate(&conn).unwrap();
    let again: i64 = conn
        .query_row("pragma user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(again, SCHEMA_VERSION);
}

/// v4/v6/v7 迁移要建出 Agent 会话、轨迹、角色、评测表与构思草稿表。
#[test]
fn migrate_creates_agent_tables() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    for table in [
        "agent_session",
        "agent_message",
        "agent_step",
        "agent_role",
        "agent_eval_run",
        "ideation_draft",
    ] {
        let exists: bool = conn
            .query_row(
                "select exists(select 1 from sqlite_master where type = 'table' and name = ?1)",
                [table],
                |row| row.get(0),
            )
            .unwrap();
        assert!(exists, "表 {table} 应在迁移后存在");
    }
    // 重复迁移不应报错，表已存在时保持幂等。
    migrate(&conn).unwrap();
}

/// 版本迁移要先去掉历史重复版本号，否则唯一索引会建不起来（老库直接打不开）。
#[test]
fn migrate_dedupes_draft_versions_before_unique_index() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        r#"
        create table chapter (id text primary key, project_id text not null,
            act integer not null default 1, title text not null, sort_order integer not null default 0,
            summary text not null default '', status text not null default 'planned',
            content text not null default '', word_count integer not null default 0,
            created_at text not null, updated_at text not null);
        create table draft_version (id text primary key, chapter_id text not null,
            content text not null default '', word_count integer not null default 0,
            version integer not null, created_at text not null);
        insert into draft_version values ('a', 'ch1', 'x', 1, 1, 't');
        insert into draft_version values ('b', 'ch1', 'y', 1, 3, 't');
        "#,
    )
    .unwrap();
    migrate(&conn).unwrap();
    let count: i64 = conn
        .query_row(
            "select count(*) from draft_version where chapter_id = 'ch1' and version = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

/// 历史上出现过「user_version 已经是 2、chapter 却没补上 content_revision」的库：
/// 旧迁移分支不会再执行，打开写作台直接报 `no such column: content_revision`。
/// 迁移不能只看版本号，必须把这类库的结构补齐。
#[test]
fn migrate_repairs_missing_columns_when_version_is_ahead() {
    let conn = Connection::open_in_memory().unwrap();
    // 造一个「v2 结构但缺 content_revision」的库。
    conn.execute_batch(
        r#"
        create table chapter (
            id text primary key,
            project_id text not null,
            act integer not null default 1,
            title text not null,
            sort_order integer not null default 0,
            summary text not null default '',
            status text not null default 'planned',
            content text not null default '',
            word_count integer not null default 0,
            created_at text not null,
            updated_at text not null
        );
        pragma user_version = 2;
        "#,
    )
    .unwrap();

    migrate(&conn).unwrap();

    // 补列之后，读取正文的那条语句必须能编译通过（缺列时 prepare 就会报错）。
    conn.prepare(
        "select id, content, word_count, content_revision, updated_at from chapter where id = ?1",
    )
    .expect("读取正文的语句应当可用");

    conn.execute(
        "insert into chapter (id, project_id, title, created_at, updated_at)
         values ('ch', 'p', 't', 'x', 'x')",
        [],
    )
    .unwrap();
    let revision: i64 = conn
        .query_row(
            "select content_revision from chapter where id = 'ch'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(revision, 0, "补上的列要有默认值");

    let version: i64 = conn
        .query_row("pragma user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION);
}

/// 版本号已经到 9、却因为迁移中断少了 meta_revision 的库也必须能自愈：
/// 大纲乐观锁直接读这一列，缺列会让缓存的大纲页一保存就报错。
#[test]
fn migrate_repairs_meta_revision_when_version_is_ahead() {
    let conn = Connection::open_in_memory().unwrap();
    init_schema(&conn).unwrap();
    conn.execute_batch(
        "alter table chapter drop column meta_revision;
         pragma user_version = 9;",
    )
    .unwrap();

    migrate(&conn).unwrap();

    // 空库没有作品行，插章会撞外键；只要读取语句能编译就说明列已经补回。
    conn.prepare("select meta_revision from chapter where id = 'ch'")
        .expect("补列后读取语句应当可用");
    let version: i64 = conn
        .query_row("pragma user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA_VERSION, "结构自愈不能回退版本号");
}

/// 手动验证用：在真实老库的**副本**上跑一次完整迁移，确认缺列被补齐、数据仍在。
///
/// 先备份：`sqlite3 -readonly <真实库> ".backup '/tmp/ih-migrate-check/ink-harness.db'"`
/// 再执行：`INK_HARNESS_DB_CHECK=/tmp/ih-migrate-check cargo test migrate_real_db_copy -- --ignored --nocapture`
#[test]
#[ignore]
fn migrate_real_db_copy() {
    let dir = std::env::var("INK_HARNESS_DB_CHECK")
        .expect("需要设置 INK_HARNESS_DB_CHECK 指向含 ink-harness.db 的目录");
    let state = super::open(&std::path::PathBuf::from(dir)).expect("迁移失败");

    let (version, has_revision, chapters) = {
        let conn = state.biz();
        let version: i64 = conn
            .query_row("pragma user_version", [], |row| row.get(0))
            .unwrap();
        let has_revision: i64 = conn
            .query_row(
                "select count(*) from pragma_table_info('chapter') where name = 'content_revision'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let chapters: i64 = conn
            .query_row("select count(*) from chapter", [], |row| row.get(0))
            .unwrap();
        (version, has_revision, chapters)
    };
    println!("user_version = {version}, content_revision 列 = {has_revision}, 章节数 = {chapters}");
    assert_eq!(version, SCHEMA_VERSION);
    assert_eq!(has_revision, 1, "缺列必须被补齐");
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
