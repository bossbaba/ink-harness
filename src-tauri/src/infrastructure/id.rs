//! 主键生成：时间戳 + 进程内自增序号，前缀区分实体类型。
//! 不引入 uuid 依赖，离线桌面场景下同一毫秒内多次创建也能保证唯一。

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// 生成形如 `ch-18f2a1b3c4d-0` 的主键。
pub fn gen_id(prefix: &str) -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{prefix}-{ts:x}-{n:x}")
}

#[cfg(test)]
mod tests {
    use super::gen_id;

    #[test]
    fn ids_are_prefixed_and_unique() {
        let a = gen_id("ch");
        let b = gen_id("ch");
        assert!(a.starts_with("ch-"));
        assert_ne!(a, b);
    }
}
