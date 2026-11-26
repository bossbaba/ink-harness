import { guardWindowClose } from "@/api/tauri";

/**
 * 窗口生命周期服务：业务层只依赖这里，不直接 import `@/api/tauri` 或原生包。
 * 原生窗口 API 的注册细节由 api 层收口，本层保持服务门面的单一出口。
 */
export const windowService = {
  guardWindowClose,
};
