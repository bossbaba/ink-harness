//! 文件落盘基础设施：应用自身的文件写入能力，不依赖 Tauri 插件的 scope。

use crate::error::AppError;
use std::path::{Path, PathBuf};

/// 允许导出的扩展名白名单，与前端 `publishService` 的格式表保持一致。
/// 任何不在表内的扩展名一律拒绝，避免把导出通道变成「任意文件写」。
const ALLOWED_EXTENSIONS: [&str; 6] = ["md", "html", "epub", "docx", "txt", "pdf"];

/// 把字节写到指定路径并返回写入大小。
///
/// 路径虽然来自用户在原生保存对话框里的显式选择，但渲染进程可以伪造任意字符串，
/// 后端不能把「用户选的」当安全前提。这里做三件事：
/// 1. 只接受绝对路径，且最终目录必须已存在（不替用户建目录）；
/// 2. 扩展名必须在导出白名单内（挡住 `.zshrc`、`.plist`、`authorized_keys` 这类无扩展名/敏感后缀）；
/// 3. 拒绝隐藏文件名，避免顺手覆盖 `~/.xxx` 下的配置。
pub fn write_export(path: &str, data: &[u8]) -> Result<usize, AppError> {
    let target = resolve_export_path(path)?;
    std::fs::write(&target, data)
        .map_err(|err| format!("写入文件失败：{err}（路径：{}）", target.display()))?;
    Ok(data.len())
}

/// 校验并规范化导出路径。独立成函数便于单测，不碰文件系统内容（只查目录是否存在）。
fn resolve_export_path(path: &str) -> Result<PathBuf, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("导出路径为空"));
    }

    let target = Path::new(trimmed);
    if !target.is_absolute() {
        return Err(AppError::validation(format!(
            "导出路径必须是绝对路径：{trimmed}"
        )));
    }

    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::validation(format!("导出路径缺少文件名：{trimmed}")))?;
    if file_name.starts_with('.') {
        return Err(AppError::validation("不允许导出为隐藏文件"));
    }

    let extension = target
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::validation(format!(
            "不支持导出为「.{extension}」文件，仅支持：{}",
            ALLOWED_EXTENSIONS.join("、")
        )));
    }

    // canonicalize 会把 `..` 与符号链接解析成真实目录，既验证目录存在，也防止用 `../` 逃逸到别处。
    let parent = target
        .parent()
        .ok_or_else(|| AppError::validation(format!("导出路径没有上级目录：{trimmed}")))?;
    let parent = parent
        .canonicalize()
        .map_err(|_| AppError::validation(format!("导出目录不存在：{}", parent.display())))?;
    if !parent.is_dir() {
        return Err(AppError::validation(format!(
            "导出目录无效：{}",
            parent.display()
        )));
    }

    Ok(parent.join(file_name))
}

#[cfg(test)]
mod tests {
    use super::resolve_export_path;

    #[test]
    fn rejects_relative_path() {
        assert!(resolve_export_path("book.md").is_err());
    }

    #[test]
    fn rejects_missing_extension() {
        assert!(resolve_export_path("/tmp/zshrc").is_err());
    }

    #[test]
    fn rejects_sensitive_extension() {
        assert!(resolve_export_path("/tmp/launch.plist").is_err());
        assert!(resolve_export_path("/tmp/run.sh").is_err());
    }

    #[test]
    fn rejects_hidden_file() {
        assert!(resolve_export_path("/tmp/.zshrc.md").is_err());
    }

    #[test]
    fn rejects_missing_directory() {
        assert!(resolve_export_path("/tmp/ink-harness-not-exists-xyz/book.md").is_err());
    }

    #[test]
    fn accepts_existing_directory_and_known_extension() {
        let dir = std::env::temp_dir();
        let path = dir.join("ink-harness-export-test.MD");
        let resolved = resolve_export_path(path.to_str().unwrap()).expect("应通过校验");
        assert_eq!(resolved, dir.canonicalize().unwrap().join("ink-harness-export-test.MD"));
    }
}
