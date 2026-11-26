//! vec0 向量表枚举：启动清理孤儿片段与 RAG 删片段都要遍历所有维度表。
//!
//! 放在基础设施层是因为它也服务于数据库启动清理；若由 services/rag 提供，
//! infrastructure/db 就得反向依赖 service，依赖方向会形成环。

use rusqlite::{Connection, params};

use crate::error::AppError;

const LEGACY_TABLE: &str = "vec_rag";

/// 库里所有向量表（含升级前的 `vec_rag`）。删片段时必须按 rowid 清理每一张，
/// 否则换过维度的作品再删章节时，其它表里的旧向量会变成永远回收不掉的幽灵数据。
///
/// sqlite-vec 会为虚拟表建 `vec_rag_3_data` / `vec_rag_3_index` 之类的影子表，
/// 这里只保留纯数字后缀的实体表名，否则会把影子表当成向量表去删。
pub(crate) fn all_vec_table_names(conn: &Connection) -> Result<Vec<String>, AppError> {
    let mut stmt = conn
        .prepare("select name from sqlite_master where type = 'table' and name like 'vec_rag%'")
        .map_err(AppError::from)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(AppError::from)?;
    let names = rows.collect::<Result<Vec<String>, _>>().map_err(AppError::from)?;
    Ok(names
        .into_iter()
        .filter(|name| {
            if name == LEGACY_TABLE {
                return true;
            }
            name.strip_prefix("vec_rag_")
                .is_some_and(|suffix| !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()))
        })
        .collect())
}

/// 按 rowid 清掉所有向量表里的同一批片段。换过维度的库在旧表和新表里
/// 可能都有同一条记录，必须遍历全部表，否则幽灵向量会挤掉 KNN 候选。
///
/// 只负责向量库；`rag_chunk` 元数据在业务库里，由调用方各自在同一个事务上下文中删除。
pub(crate) fn delete_vec_rows(conn: &Connection, ids: &[i64]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    for table in all_vec_table_names(conn)? {
        let sql = format!("delete from {table} where rowid = ?1");
        let mut stmt = conn.prepare(&sql).map_err(AppError::from)?;
        for id in ids {
            stmt.execute(params![id]).map_err(AppError::from)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_real_vector_tables() {
        let conn = Connection::open_in_memory().unwrap();
        for sql in [
            "create table vec_rag (id text)",
            "create table vec_rag_3 (id text)",
            "create table vec_rag_3_data (id text)",
            "create table rag_chunk (id text)",
        ] {
            conn.execute_batch(sql).unwrap();
        }
        assert_eq!(all_vec_table_names(&conn).unwrap(), ["vec_rag", "vec_rag_3"]);
    }
}
