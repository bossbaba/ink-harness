import { tauriApi } from "@/api/tauri";
import type { WorkspaceStats } from "@/types";

/**
 * 全局统计领域服务：跨作品汇总作品数/章节数/字数/设定数，只读。
 * 单独成 service 是为了让 composable 不必直接依赖 `@/api/tauri`，
 * 命令名与返回类型仍然只由 api 层定义一处。
 */
export const statsService = {
  workspace: (): Promise<WorkspaceStats> => tauriApi.workspaceStats(),
};
