//! 导出落盘命令。

use crate::commands::blocking;
use crate::error::AppError;
use crate::infrastructure::fs;
use crate::models::ExportResult;

/// 把已经生成好的文件字节写到用户通过原生对话框选定的路径。
///
/// 写文件是阻塞 IO，走阻塞线程池；路径与扩展名由 `fs::write_export` 校验。
#[tauri::command]
pub async fn write_export_file(
    app: tauri::AppHandle,
    path: String,
    data: Vec<u8>,
) -> Result<ExportResult, AppError> {
    blocking(app, move |_state| {
        let size = fs::write_export(&path, &data)?;
        Ok(ExportResult { path, size })
    })
    .await
}
