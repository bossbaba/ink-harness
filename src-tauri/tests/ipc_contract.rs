//! 前后端命令契约检查。
//!
//! 前端通过 `src/api/tauri.ts` 里的 `call("命令名")` 调后端，后端在
//! `src/lib.rs` 的 `invoke_handler` 里注册。两边都是手工维护的，最容易出的事故是
//! 「前端调了一个没注册的命令」——只有真的走到那条代码路径才会报
//! `command not found`，普通点测很容易漏。
//!
//! 这个测试把两侧的命令集合抽出来做双向比对，属于无依赖的类型契约校验
//! （字段级类型仍靠 `models/` 与 `src/types/` 对齐，见 docs/reviews 里的说明）。

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read(relative: &str) -> String {
    let path = manifest_dir().join(relative);
    fs::read_to_string(&path).unwrap_or_else(|err| panic!("读取 {} 失败：{err}", path.display()))
}

/// 命令名只允许小写字母与下划线，用它过滤掉 `call<T>(...)` 函数定义本身。
fn is_command_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c == '_')
}

/// 从前端封装里抽 `call<...>("命令名", ...)`。`rawInvoke` 是内部实现，不参与比对。
fn frontend_commands(source: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    let mut rest = source;
    while let Some(pos) = rest.find("call<") {
        rest = &rest[pos + "call<".len()..];
        let Some(open) = rest.find('(') else { break };
        rest = &rest[open + 1..];
        let Some(quote) = rest.find('"') else { break };
        let after = &rest[quote + 1..];
        let Some(end) = after.find('"') else { break };
        let name = &after[..end];
        if is_command_name(name) {
            names.insert(name.to_string());
        }
        rest = &after[end..];
    }
    names
}

/// 从 `lib.rs` 的 `generate_handler![...]` 里抽注册项，取路径最后一段。
fn backend_commands(source: &str) -> BTreeSet<String> {
    let start = source
        .find("generate_handler![")
        .expect("lib.rs 里应存在 generate_handler![");
    let body_start = start + "generate_handler![".len();
    let end = source[body_start..]
        .find(']')
        .map(|offset| body_start + offset)
        .expect("generate_handler! 缺少结束的 ]");

    source[body_start..end]
        .split(',')
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.rsplit("::").next().unwrap_or(entry).to_string())
        .collect()
}

#[test]
fn every_frontend_command_is_registered() {
    let frontend = frontend_commands(&read("../src/api/tauri.ts"));
    let backend = backend_commands(&read("src/lib.rs"));

    let missing: Vec<&String> = frontend.difference(&backend).collect();
    assert!(
        missing.is_empty(),
        "前端调用了后端未注册的命令：{missing:?}\n注册表在 src/lib.rs 的 invoke_handler"
    );

    let unused: Vec<&String> = backend.difference(&frontend).collect();
    assert!(
        unused.is_empty(),
        "后端注册了前端从未调用的命令：{unused:?}\n要么删掉，要么补上前端封装，避免留死命令"
    );
}
