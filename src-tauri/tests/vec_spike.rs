use rusqlite::{ffi::sqlite3_auto_extension, Connection};

fn register_vec() {
    unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    }
}

#[test]
fn vec_extension_registers_and_reports_version() {
    register_vec();
    let conn = Connection::open_in_memory().unwrap();
    let version: String = conn
        .query_row("select vec_version()", [], |row| row.get(0))
        .unwrap();
    assert!(version.starts_with('v'), "unexpected version: {version}");
}

#[test]
fn vec0_table_knn_query_returns_nearest_first() {
    register_vec();
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "create virtual table items using vec0(embedding float[3]);
         insert into items(rowid, embedding) values (1, '[1,0,0]'), (2, '[0,1,0]'), (3, '[0.9,0.1,0]');",
    )
    .unwrap();

    let mut stmt = conn
        .prepare(
            "select rowid, distance from items
             where embedding match '[1,0,0]'
             order by distance limit 2",
        )
        .unwrap();
    let rows: Vec<(i64, f64)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, 1, "nearest should be rowid 1");
    assert!(rows[0].1 < rows[1].1, "results must be ordered by distance");
}

#[test]
fn vec_and_business_tables_coexist_in_one_file() {
    register_vec();
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "create table project(id text primary key, title text not null);
         insert into project values('p1', '测试作品');
         create virtual table vec_items using vec0(embedding float[2]);
         insert into vec_items(rowid, embedding) values (1, '[0.2,0.8]');",
    )
    .unwrap();

    let title: String = conn
        .query_row("select title from project where id='p1'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "测试作品");
    let count: i64 = conn
        .query_row("select count(*) from vec_items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}
