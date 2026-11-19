#!/usr/bin/env bash
# Rust 纯逻辑模块的运行时 UB 检测。
#
# 背景：主 crate 链接了 tauri（WebKit/AppKit 等 framework），Miri 会在碰到 SQLite FFI
# 时中止、ASan 会因 `-nodefaultlibs` 与 framework 冲突而链接失败。因此把不依赖 FFI 的
# 纯逻辑模块通过 #[path] 汇入 src-tauri/ub-check 这个独立 crate，两种检测器都只跑它。
#
# 用法：
#   ./scripts/check-ub.sh            # 默认同时跑 miri + asan
#   ./scripts/check-ub.sh miri       # 只跑 Miri（解释执行，检测未定义行为）
#   ./scripts/check-ub.sh asan       # 只跑 ASan（编译插桩，检测越界/UAF）
#
# 前提：本机需有 nightly 工具链与 miri 组件：
#   rustup toolchain install nightly --profile minimal --component miri

set -euo pipefail

# 检测目标固定为 ub-check：无论从仓根还是别处调用，都先切到它的目录。
CHECK_DIR="$(cd "$(dirname "$0")/../src-tauri/ub-check" && pwd)"
cd "$CHECK_DIR"

# 这台机器上 Homebrew 的 cargo/rustc 抢在 rustup proxy 前面，直接用裸命令会回落到 stable，
# 导致 -Z / cargo miri 报「only accepted on the nightly compiler」。这里显式取 nightly 路径。
NIGHTLY_CARGO="$(rustup which --toolchain nightly cargo)"
NIGHTLY_RUSTC="$(rustup which --toolchain nightly rustc)"

# macOS 目标三元组，ASan 需要显式 --target 让 proc-macro 走不带 sanitizer 的 host 编译。
TARGET="aarch64-apple-darwin"
case "$(uname -m)" in
  arm64|aarch64) TARGET="aarch64-apple-darwin" ;;
  x86_64)        TARGET="x86_64-apple-darwin" ;;
esac

MODE="${1:-all}"

run_miri() {
  echo "==> Miri: 解释执行纯逻辑测试，检测未定义行为"
  # cargo miri 子命令必须由 rustup 代理拉起，否则会去找 stable 的 cargo-miri。
  # 用 --tests 覆盖 lib 单测 + tests/boundaries.rs，并跳过 doctest
  # （doctest 由 rustdoc 驱动，Homebrew 的 stable rustdoc 不认 -Z 参数）。
  RUSTC="$NIGHTLY_RUSTC" rustup run nightly cargo miri test --tests
}

run_asan() {
  echo "==> ASan: 编译插桩检测越界 / 释放后使用"
  # RUSTFLAGS 会连带污染 proc-macro（Rust 不支持带 sanitizer 编译 proc-macro），
  # 因此用 target-specific 的 rustflags，让 host 侧的 proc-macro 正常编译。
  # shell 不支持带空格值的动态变量名前缀赋值，这里先把变量名展开再 export。
  local rustflags_var="CARGO_TARGET_$(echo "$TARGET" | tr 'a-z-' 'A-Z_')_RUSTFLAGS"
  export RUSTC="$NIGHTLY_RUSTC" CARGO_TARGET_DIR=target/asan
  export "$rustflags_var=-Zsanitizer=address -Cdebuginfo=2"
  "$NIGHTLY_CARGO" test --tests --target "$TARGET"
}

case "$MODE" in
  miri) run_miri ;;
  asan) run_asan ;;
  all)  run_miri && run_asan ;;
  *)    echo "未知模式: $MODE（可选: miri / asan / all）" >&2; exit 2 ;;
esac
