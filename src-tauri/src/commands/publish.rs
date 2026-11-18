use serde::Serialize;

/// 导出结果：让界面能显示文件真正写到了哪里、有多大。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub size: usize,
}

/// 把已经生成好的文件字节写到用户通过原生对话框选定的路径。
///
/// 这里不接 fs 插件的 scope：路径来自用户显式选择，写文件属于应用自身能力；
/// 生成逻辑全在前端，Rust 侧只做一次落盘，不解析也不改写内容。
#[tauri::command]
pub fn write_export_file(path: String, data: Vec<u8>) -> Result<ExportResult, String> {
    let size = data.len();
    std::fs::write(&path, &data).map_err(|err| format!("写入文件失败：{err}"))?;
    Ok(ExportResult { path, size })
}
