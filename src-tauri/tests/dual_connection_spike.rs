use std::time::Duration;

use rusqlite::{ffi::sqlite3_auto_extension, Connection};

fn register_vec() {
    unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    }
}

/// 模拟方案的真实形态：一个连接扮演 plugin-sql（业务 CRUD），
/// 另一个扮演 rusqlite（向量）。同一 WAL 文件上并发短事务，验证无锁冲突。
#[test]
fn dual_connection_wal_concurrent_read_write() {
    register_vec();
    let dir = std::env::temp_dir().join(format!("ink-harness-spike-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("test.db");
    let url = format!("sqlite://{}", path.display());

    // 连接 A（业务侧）：建表、开 WAL
    let biz = Connection::open(&path).unwrap();
    biz.execute_batch("pragma journal_mode=WAL; create table if not exists project(id text primary key, title text);")
        .unwrap();

    // 连接 B（向量侧）：建 vec0 表，并确认能看到 auto_extension
    let vec = Connection::open(&path).unwrap();
    vec.execute_batch("create virtual table if not exists vec_items using vec0(embedding float[3]);")
        .unwrap();

    // 交替写入 + 查询，循环若干次
    for i in 0..20 {
        biz.execute(
            "insert or replace into project(id,title) values(?1,?2)",
            rusqlite::params![format!("p{i}"), format!("作品{i}")],
        )
        .unwrap();
        vec.execute(
            "insert into vec_items(rowid, embedding) values(?1, ?2)",
            rusqlite::params![i + 1, format!("[{},0,0]", i)],
        )
        .unwrap();

        let cnt: i64 = biz
            .query_row("select count(*) from project", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, i + 1);

        // 向量连接能读到业务连接刚写的数据（同一 WAL 文件可见）
        let biz_visible_from_vec: i64 = vec
            .query_row("select count(*) from project", [], |r| r.get(0))
            .unwrap();
        assert_eq!(biz_visible_from_vec, i + 1);
    }

    // 业务连接也能查向量函数（共享同一个 libsqlite3-sys → auto_extension 全局可见）
    let version: String = biz
        .query_row("select vec_version()", [], |r| r.get(0))
        .unwrap();
    assert!(version.starts_with('v'));

    drop(biz);
    drop(vec);
    std::fs::remove_dir_all(&dir).ok();
    let _ = url; // 仅用于记录连接URL形态，避免未使用告警
}

/// 验证 timeout 设置能为并发写提供等待，而不是立刻 database is locked。
#[test]
fn busy_timeout_allows_waiting_writer() {
    register_vec();
    let dir = std::env::temp_dir().join(format!("ink-harness-timeout-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("t.db");

    let setup = Connection::open(&path).unwrap();
    setup
        .execute_batch("pragma journal_mode=WAL; create table t(x integer);")
        .unwrap();
    drop(setup);

    // 线程 A：持有一个写事务 200ms 后提交（连接在该线程内创建，避免 !Send 问题）
    let path_a = path.clone();
    let handle = std::thread::spawn(move || {
        let a = Connection::open(&path_a).unwrap();
        a.busy_timeout(Duration::from_secs(2)).unwrap();
        let tx = a.unchecked_transaction().unwrap();
        tx.execute("insert into t values(1)", []).unwrap();
        std::thread::sleep(Duration::from_millis(200));
        tx.commit().unwrap();
    });

    // 主线程：在 A 持锁期间发起写入，busy_timeout 会等待 A 提交后成功，而非立刻报错
    std::thread::sleep(Duration::from_millis(50));
    let b = Connection::open(&path).unwrap();
    b.busy_timeout(Duration::from_secs(2)).unwrap();
    b.execute("insert into t values(2)", []).unwrap();

    handle.join().unwrap();
    let cnt: i64 = b.query_row("select count(*) from t", [], |r| r.get(0)).unwrap();
    assert_eq!(cnt, 2);
    drop(b);
    std::fs::remove_dir_all(&dir).ok();
}
