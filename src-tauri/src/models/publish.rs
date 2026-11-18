//! 出版导出 DTO：文件落盘结果，与命令层分离。

use serde::Serialize;

/// 导出结果：让界面能显示文件真正写到了哪里、有多大。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub size: usize,
}
