//! 流式请求的主动取消。
//!
//! Tauri 的 `Channel` 没有公开的 close()，前端无法从接收端通知后端停止；
//! 旧实现只靠前端丢弃迟到分片，模型侧仍在继续生成并计费。
//! 这里按 `requestId` 维护一张取消标志表，前端「停止」调用 `cancel_chat` 置位，
//! 网关在读流循环里检查标志并主动断开 reqwest 请求。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// 一次请求对应的取消标志；clone 出来的是同一个 AtomicBool。
#[derive(Clone, Default)]
pub struct CancelFlag {
    inner: Arc<AtomicBool>,
}

impl CancelFlag {
    /// 热路径每 200ms 轮询一次，布尔值没有其它关联数据，Relaxed 足够。
    pub fn is_cancelled(&self) -> bool {
        self.inner.load(Ordering::Relaxed)
    }

    /// 由 `cancel_chat` 置位；重复调用没有副作用。
    pub fn cancel(&self) {
        self.inner.store(true, Ordering::Relaxed);
    }
}

/// 按 requestId 索引的取消表，由 Tauri 以 `Arc<CancelRegistry>` 全局管理。
#[derive(Default)]
pub struct CancelRegistry {
    flags: Mutex<HashMap<String, CancelFlag>>,
}

impl CancelRegistry {
    /// 注册一个请求。返回的 guard 离开作用域时自动摘除，避免请求结束后表无限增长。
    pub fn register(self: &Arc<Self>, request_id: Option<&str>) -> CancelGuard {
        let flag = CancelFlag::default();
        // 老调用方可能不带 requestId：给它一个孤立标志，退化为原来的「只看 Channel」行为。
        let id = request_id.filter(|id| !id.is_empty()).map(str::to_string);
        if let Some(id) = &id {
            // 锁中毒时取回内部数据：这里只存布尔标志，不该让对话因别的线程 panic 而失败。
            let mut flags = self.flags.lock().unwrap_or_else(|err| err.into_inner());
            flags.insert(id.clone(), flag.clone());
        }
        CancelGuard {
            registry: self.clone(),
            id,
            flag,
        }
    }

    /// 前端点「停止」时调用：只置标志，不直接碰 Channel——
    /// 由读流循环在下一个检查点退出，才能保证 reqwest 连接也被释放。
    pub fn cancel(&self, request_id: &str) {
        let flags = self.flags.lock().unwrap_or_else(|err| err.into_inner());
        if let Some(flag) = flags.get(request_id) {
            flag.cancel();
        }
    }
}

/// 注册表的生命周期凭证，Drop 时自动注销对应 requestId。
pub struct CancelGuard {
    registry: Arc<CancelRegistry>,
    id: Option<String>,
    flag: CancelFlag,
}

impl CancelGuard {
    pub fn flag(&self) -> CancelFlag {
        self.flag.clone()
    }
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        let Some(id) = &self.id else { return };
        let mut flags = self.registry.flags.lock().unwrap_or_else(|err| err.into_inner());
        flags.remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_reaches_guard_and_entry_is_removed_on_drop() {
        let registry = Arc::new(CancelRegistry::default());
        let guard = registry.register(Some("req-1"));
        assert!(!guard.flag().is_cancelled());

        registry.cancel("req-1");
        assert!(guard.flag().is_cancelled());

        // 不存在的 ID 不该误伤其它请求。
        registry.cancel("nope");
        let other = registry.register(Some("req-2"));
        assert!(!other.flag().is_cancelled());

        drop(guard);
        // 同一个 ID 再次注册时必须拿到全新标志，否则「停止」会连到下一次请求。
        let again = registry.register(Some("req-1"));
        assert!(!again.flag().is_cancelled());
    }

    #[test]
    fn request_id_absent_degrades_to_standalone_flag() {
        let registry = Arc::new(CancelRegistry::default());
        let guard = registry.register(None);
        registry.cancel("");
        assert!(!guard.flag().is_cancelled());
    }
}
