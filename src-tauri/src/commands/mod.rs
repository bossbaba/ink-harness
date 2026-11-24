//! 命令层：Tauri IPC 与 service 之间的薄适配。
//!
//! 数据库类命令一律走 [`blocking`]：Tauri 的同步命令跑在主线程，SQLite 稍慢
//! （锁等待、几千行扫描）就会卡住窗口输入与动画。service 层刻意不依赖 Tauri，
//! 所以 `AppHandle` 只出现在这一层。

pub mod agent;
pub mod draft;
pub mod ideation;
pub mod keychain;
pub mod mcp;
pub mod model;
pub mod ollama;
pub mod outline;
pub mod project;
pub mod publish;
pub mod rag;
pub mod setting;
pub mod stats;
pub mod story_element;
pub mod usage;

use tauri::Manager;

use crate::error::AppError;
use crate::infrastructure::db::DbState;

/// 把数据库/文件 IO 搬到阻塞线程池执行，再把结果带回 async 命令。
///
/// 闭包拿到 `&DbState`，与之前的 `State<'_, DbState>` 用法一致；
/// 因为要跨线程，闭包必须 `Send + 'static`，调用方参数需 `move` 进闭包。
pub async fn blocking<T, F>(app: tauri::AppHandle, job: F) -> Result<T, AppError>
where
    F: FnOnce(&DbState) -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<DbState>();
        job(state.inner())
    })
    .await
    .map_err(|err| AppError::internal(format!("后台任务执行失败：{err}")))?
}
