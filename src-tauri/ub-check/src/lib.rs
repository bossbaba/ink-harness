//! 纯逻辑模块的 UB 检测载体（实验性）。
//!
//! 通过 `#[path]` 直接引入主 crate 的纯逻辑源码，让 Miri / ASan 在脱离
//! tauri、SQLite、reqwest 等 FFI 依赖的环境下运行这些模块的单元测试。
//! 源码只有一份：主 crate 与这里共享同一批文件，改逻辑时不会两边漂移。

// URL 与 Provider 方言判断：纯字符串处理，无 FFI。
#[path = "../../src/services/provider_kind.rs"]
pub mod provider_kind;

// gateway_sse 里的事件结构（TokenUsage / ToolCallChunk）来自主 crate 的 models。
// chat.rs 自包含（只依赖 serde），引入为 models 模块即可满足解析器的类型引用。
#[path = "../../src/models/chat.rs"]
pub mod models;

// 流式响应解析：只依赖 serde_json，无 FFI。
#[path = "../../src/services/gateway_sse.rs"]
pub mod gateway_sse;

// 检索文本切分：只依赖 serde_json，无 FFI。
#[path = "../../src/services/rag/chunk.rs"]
pub mod rag_chunk;
