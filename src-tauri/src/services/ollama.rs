//! Ollama 服务检测与启动。
//!
//! 检测走 `GET /api/tags`；启动优先拉起桌面版 App（macOS 的 `open -a Ollama`），
//! 找不到桌面版时回退到 `ollama serve`。两种情况都会轮询到服务真正可用才返回，
//! 避免前端「点完按钮立刻又显示未运行」。

use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::infrastructure::llm_http;
use crate::models::OllamaStatus;

/// 启动后等待服务就绪的最长时间：冷启动加载模型列表通常 2~5 秒，留足余量。
const START_TIMEOUT: Duration = Duration::from_secs(20);
/// 就绪轮询间隔；太密会刷屏，太疏用户会觉得卡。
const POLL_INTERVAL: Duration = Duration::from_millis(500);

pub async fn check() -> Result<OllamaStatus, AppError> {
    let client = llm_http::probe_client()?;

    let running = client
        .get(llm_http::OLLAMA_TAGS_URL)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    let models = if running {
        fetch_models(&client).await.unwrap_or_default()
    } else {
        vec![]
    };

    Ok(OllamaStatus {
        // 服务没跑不代表没装：桌面版 App 或 CLI 在就说明装过，界面据此区分「未安装」与「未启动」。
        installed: running || detect_installed(),
        running,
        models,
    })
}

async fn fetch_models(client: &reqwest::Client) -> Result<Vec<String>, AppError> {
    #[derive(serde::Deserialize)]
    struct TagsResponse {
        models: Vec<TagsModel>,
    }
    #[derive(serde::Deserialize)]
    struct TagsModel {
        name: String,
    }

    let res = client
        .get(llm_http::OLLAMA_TAGS_URL)
        .send()
        .await
        .map_err(AppError::from)?;
    let tags: TagsResponse = res.json().await.map_err(AppError::from)?;
    Ok(tags.models.into_iter().map(|m| m.name).collect())
}

/// 从程序内启动本地 Ollama，并等到服务可用后返回最新状态。
pub async fn start() -> Result<OllamaStatus, AppError> {
    let status = check().await?;
    if status.running {
        return Ok(status);
    }
    if !status.installed {
        return Err(AppError::validation("未检测到 Ollama。请先安装桌面版（ollama.com）或命令行工具，再回来点「启动本地模型」。"));
    }

    launch()?;

    let deadline = Instant::now() + START_TIMEOUT;
    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        let current = check().await?;
        if current.running {
            return Ok(current);
        }
        if Instant::now() >= deadline {
            return Err(AppError::network(format!(
                "Ollama 已发出启动指令，但 {} 秒内仍未就绪。可稍等片刻后点「重新检测」，或手动执行 `ollama serve` 查看报错。",
                START_TIMEOUT.as_secs()
            )));
        }
    }
}

/// 拉起 Ollama。桌面版 App 会顺带把后台服务带起来，CLI 则直接跑 `ollama serve`。
fn launch() -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        // 大多数 macOS 用户装的是桌面版；`open -a` 会立刻返回，服务在后台异步起来。
        let opened = Command::new("open")
            .args(["-a", "Ollama"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if opened {
            return Ok(());
        }
    }
    spawn_serve()
}

/// 直接 spawn `ollama serve`：输出丢弃，并起一个线程回收子进程，避免留下僵尸进程。
///
/// 记下自己拉起的 PID：App 退出时只停这一个实例，
/// 用户手动启动或别的工具正在用的服务不会被误杀（见 `stop_spawned`）。
fn spawn_serve() -> Result<(), AppError> {
    let binary = resolve_binary()
        .ok_or_else(|| AppError::not_found("找不到 ollama 可执行文件，请先安装 Ollama（ollama.com）。"))?;
    let mut child = Command::new(binary)
        .arg("serve")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 `ollama serve` 失败：{e}"))?;
    remember_pid(child.id());
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// 本进程拉起的 ollama PID；桌面版 App（`open -a Ollama`）由系统托管，不记录。
static SPAWNED_PID: Mutex<Option<u32>> = Mutex::new(None);

/// 锁中毒时取回内部值继续用：这里只存一个 PID，没有会被破坏的不变量。
fn lock_pid() -> std::sync::MutexGuard<'static, Option<u32>> {
    SPAWNED_PID.lock().unwrap_or_else(|err| err.into_inner())
}

fn remember_pid(pid: u32) {
    *lock_pid() = Some(pid);
}

/// 仅供测试：当前记录的 PID（生产路径不需要读它）。
#[cfg(test)]
pub fn spawned_pid() -> Option<u32> {
    *lock_pid()
}

/// 退出应用时停掉「由本进程拉起」的本地服务。
/// 没有记录（例如服务是用户自己启的、或走的是桌面版 App）时什么都不做。
pub fn stop_spawned() {
    let pid = { lock_pid().take() };
    let Some(pid) = pid else { return };
    // PID 可能已被系统回收给别的进程，动手前先确认它仍然是 ollama，避免误杀。
    if !is_ollama_process(pid) {
        return;
    }
    terminate(pid);
}

/// 确认某个 PID 现在还是不是 ollama 进程（`ps` 不可用时按「不是」处理，宁可不杀）。
fn is_ollama_process(pid: u32) -> bool {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output();
    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .to_lowercase()
            .contains("ollama"),
        _ => false,
    }
}

/// 发 SIGTERM 让 ollama 自己收尾；不引入 libc，只为这一次调用。
fn terminate(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
    // 其他平台不处理：拿不到可靠的信号机制，宁可让它继续跑。
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
    }
}

/// 是否装过 Ollama：PATH、常见安装路径、macOS App 包任一处存在即认为已安装。
fn detect_installed() -> bool {
    if resolve_binary().is_some() {
        return true;
    }
    #[cfg(target_os = "macos")]
    {
        if std::path::Path::new("/Applications/Ollama.app").exists() {
            return true;
        }
        if let Some(home) = std::env::var_os("HOME") {
            let user_app = std::path::Path::new(&home).join("Applications/Ollama.app");
            if user_app.exists() {
                return true;
            }
        }
    }
    false
}

/// 解析 ollama 可执行文件。
/// 从 Finder 启动的 Tauri 应用 PATH 很短（通常没有 /usr/local/bin），
/// 所以除了 PATH 还要显式找 Homebrew / 官方安装脚本的落点。
fn resolve_binary() -> Option<std::path::PathBuf> {
    if let Some(found) = binary_in_path("ollama") {
        return Some(found);
    }
    ["/usr/local/bin/ollama", "/opt/homebrew/bin/ollama"]
        .iter()
        .map(std::path::PathBuf::from)
        .find(|path| path.is_file())
}

/// 在 PATH 中查找可执行文件；找不到 PATH 时返回 None。
fn binary_in_path(name: &str) -> Option<std::path::PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::{
        binary_in_path, is_ollama_process, remember_pid, spawned_pid, stop_spawned, Command,
    };

    /// 查一个必然不存在的名字，确认 PATH 探测不会误报成「已安装」。
    #[test]
    fn missing_binary_is_not_found() {
        assert!(binary_in_path("ink-harness-definitely-missing").is_none());
    }

    /// 不存在的 PID 一律判为「不是 ollama」，避免 PID 被系统复用后误杀。
    #[test]
    fn missing_pid_is_not_ollama() {
        assert!(!is_ollama_process(999_999));
    }

    /// 关键安全约束：记录的 PID 若已被系统回收给别的进程，退出时不能动手。
    /// 用一个 2 秒的 sleep 冒充「被复用的 PID」，验证它不会被 kill。
    #[cfg(unix)]
    #[test]
    fn stop_spawned_skips_non_ollama_process() {
        assert_eq!(spawned_pid(), None);
        let mut child = Command::new("sleep").arg("2").spawn().unwrap();
        remember_pid(child.id());

        stop_spawned();

        // try_wait 返回 None 说明进程还在跑，正是我们要的结果。
        assert!(child.try_wait().unwrap().is_none());
        // stop_spawned 会把记录的 PID 取走，避免重复处理。
        assert_eq!(spawned_pid(), None);

        let _ = child.kill();
        let _ = child.wait();
    }
}
