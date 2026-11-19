# INK-HARNESS

本地优先的 AI 辅助写作桌面软件：作者主导、Agent 辅助，覆盖「构思 → 设定 → 大纲 → 写作 → 审稿 → 出版」全流程。所有数据留在用户机器，接本地模型（Ollama）时可完全离线。

技术栈：Tauri 2（Rust 后端）+ Vue 3 / Vite 7 / TypeScript（前端）+ SQLite（rusqlite + sqlite-vec 双连接）。设计决策与实施记录见 [`docs/产品规划与实施方案.md`](docs/产品规划与实施方案.md)。

## 环境要求

- Node.js 20.19+ / 22.12+（Vite 7 要求；本项目在 Node 24 验证过），pnpm 12+
- Rust 1.90+（见 `src-tauri/Cargo.toml` 的 `rust-version`）
- macOS 为主（目标平台假设见规划文档「待确认事项」）
- 可选：本机安装 Ollama 并拉取模型，用于本地推理；云端 Provider 需自行配置 API Key（存系统钥匙串）

## 安装与运行

```bash
pnpm install

# 只跑前端 dev server（http://localhost:1420）
pnpm dev

# 跑完整桌面应用（前端 + Rust 后端）
pnpm tauri:dev
```

## 验证

```bash
# 一次跑完全部检查：类型 + lint + 规范守卫 + 前端单测 + 构建
pnpm check:all

# 或分项执行
pnpm typecheck           # vue-tsc 类型检查
pnpm lint                # biome lint
pnpm test                # vitest 前端单测
pnpm check:conventions   # 单文件 ≤500 行 + 分层导入约束
cd src-tauri && cargo test    # Rust 单测与集成测试
pnpm build               # 类型检查 + 前端构建

# Rust 纯逻辑模块的运行时 UB 检测（Miri + ASan，需 nightly + miri 组件）
pnpm check:ub            # 两个检测器都跑
pnpm check:ub:miri       # 只跑 Miri
pnpm check:ub:asan       # 只跑 ASan
```

Rust 的 UB 检测只覆盖不依赖 FFI 的纯逻辑模块（SSE / JSONL 解析、Provider 方言判断、文本切分）。
原因是主 crate 链接了 tauri（WebKit/AppKit 等 framework）与 SQLite：Miri 一碰到 SQLite FFI 就会中止，
ASan 的 `-nodefaultlibs` 会与 GUI framework 冲突而链接失败。因此这些模块通过 `#[path]` 汇入
`src-tauri/ub-check` 这个独立 crate 再检测，测试代码与主 crate 共享、不重复维护。

首次使用需装 nightly 工具链（装 miri 组件时建议走国内镜像，否则官方源在国内很慢）：

```bash
RUSTUP_DIST_SERVER=https://mirrors.tuna.tsinghua.edu.cn/rustup \
RUSTUP_UPDATE_ROOT=https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup \
rustup toolchain install nightly --profile minimal --component miri
```

CI（`.github/workflows/ci.yml`）在 push / PR 时执行前述类型 / lint / 规范 / 单测 / 构建检查（UB 检测为本地按需运行，暂未纳入 CI 门禁）。

## 常用命令

| 命令               | 作用             |
| ------------------ | ---------------- |
| `pnpm dev`         | 前端热更新       |
| `pnpm tauri:dev`   | 桌面应用开发模式 |
| `pnpm tauri:build` | 打各平台安装包   |
| `pnpm test:watch`  | 前端单测监听模式 |
| `pnpm format`      | biome 格式化     |

## 代码结构

```
src/                     Vue 前端
├── app/                 main.ts / App.vue / router 装配
├── api/tauri.ts         唯一的 IPC 封装出口
├── services/            领域服务（可含纯逻辑）
├── composables/         页面状态与请求编排
├── components/          展示组件（只走 props/emit）
├── views/               页面组装
├── stores/              Pinia 全局状态
└── utils|types|styles   纯工具 / 类型 / 设计令牌

src-tauri/src/           Rust 后端（单向依赖 commands → services → infrastructure → models）
├── commands/            Tauri 命令层，薄适配
├── services/            领域逻辑，不依赖 Tauri
├── infrastructure/      DB / 钥匙串 / HTTP 客户端
├── models/              前后端共享的数据契约
└── ub-check/            纯逻辑模块的 UB 检测载体（独立 crate，#[path] 共享源码）

tests/                   前端单测（vitest，与业务源码分离，用 @ 别名引用被测模块）
scripts/                 工程规范守卫脚本
```

## 文档

- `docs/产品规划与实施方案.md`：产品定位、技术架构与实施清单
- `docs/reviews/`：各轮代码审查与整改记录
- `docs/changelogs/`：按日期的变更记录
