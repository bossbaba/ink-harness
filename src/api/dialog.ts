import { save } from "@tauri-apps/plugin-dialog";

/**
 * 原生文件对话框收口在 api 层：业务服务不直接 import `@tauri-apps/*`。
 * 参数只暴露导出所需的三件事，避免各处复制 filters 造成后缀白名单漂移。
 */
export async function saveExportPath(
  defaultName: string,
  extension: string,
): Promise<string | null> {
  return save({
    title: "导出作品",
    defaultPath: `${defaultName}.${extension}`,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
}
