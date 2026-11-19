//! 应用级设置读写。
//!
//! 直接复用 `app_meta` 键值表（原本只存「种子是否执行过」），不额外建表：
//! 设置项都很少、都是标量，单表足够，也省掉一次迁移。
//! 布尔值统一存 `"1"` / `"0"`，避免各家 `true/yes/on` 混用。

use rusqlite::{OptionalExtension, params};

use crate::error::AppError;
use crate::infrastructure::db::DbState;

/// 退出应用时是否停止「由本应用拉起」的本地 Ollama 服务。默认开启。
pub const STOP_OLLAMA_ON_EXIT: &str = "stop_ollama_on_exit";

pub fn get(state: &DbState, key: &str) -> Result<Option<String>, AppError> {
    let conn = state.biz();
    conn.query_row(
        "select value from app_meta where key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(AppError::from)
}

pub fn set(state: &DbState, key: &str, value: &str) -> Result<(), AppError> {
    let conn = state.biz();
    conn.execute(
        "insert into app_meta(key, value) values (?1, ?2) \
         on conflict(key) do update set value = excluded.value",
        params![key, value],
    )
    .map_err(AppError::from)?;
    Ok(())
}

/// 读布尔设置；没有存过时返回 `default`，让「默认开启」这类语义不需要种子数据。
pub fn get_bool(state: &DbState, key: &str, default: bool) -> Result<bool, AppError> {
    match get(state, key)? {
        Some(value) => Ok(value == "1" || value.eq_ignore_ascii_case("true")),
        None => Ok(default),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db;

    fn temp_state(tag: &str) -> DbState {
        let dir = std::env::temp_dir().join(format!("ih-setting-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        db::open(&dir).unwrap()
    }

    /// 没存过时按传入的默认值走，不依赖种子数据。
    #[test]
    fn missing_key_falls_back_to_default() {
        let state = temp_state("default");
        assert_eq!(get(&state, STOP_OLLAMA_ON_EXIT).unwrap(), None);
        assert!(get_bool(&state, STOP_OLLAMA_ON_EXIT, true).unwrap());
        assert!(!get_bool(&state, STOP_OLLAMA_ON_EXIT, false).unwrap());
    }

    /// 写入后能读回，重复写入按覆盖处理（不产生两行）。
    #[test]
    fn set_overwrites_existing_value() {
        let state = temp_state("overwrite");
        set(&state, STOP_OLLAMA_ON_EXIT, "0").unwrap();
        assert!(!get_bool(&state, STOP_OLLAMA_ON_EXIT, true).unwrap());

        set(&state, STOP_OLLAMA_ON_EXIT, "1").unwrap();
        assert!(get_bool(&state, STOP_OLLAMA_ON_EXIT, false).unwrap());

        let conn = state.biz();
        let count: i64 = conn
            .query_row(
                "select count(*) from app_meta where key = ?1",
                params![STOP_OLLAMA_ON_EXIT],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
