import { tauriApi } from "@/api/tauri";
import type { OllamaStatus } from "@/types";

/**
 * 本地运行时服务：后端就绪探测与本地模型（Ollama）的生命周期。
 *
 * 这两个能力原来由 composable 直接调 `@/api/tauri`，属于越层——
 * 换命令、加超时、改错误处理都得改界面代码。收口到 service 后，
 * composable 只负责界面状态。
 */
export const runtimeService = {
  /** 后端是否就绪；失败时调用方展示「后端未就绪」。 */
  ping: (): Promise<string> => tauriApi.ping(),

  /** 探测本地 Ollama 安装与运行状态（不会启动它）。 */
  checkOllama: (): Promise<OllamaStatus> => tauriApi.checkOllama(),

  /** 主动启动本地模型，后端等到服务可用才返回。 */
  startOllama: (): Promise<OllamaStatus> => tauriApi.startOllama(),
};
