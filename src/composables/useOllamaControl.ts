import { ref } from "vue";
import { runtimeService } from "@/services/runtimeService";
import type { OllamaStatus } from "@/types";

/**
 * 本地 Ollama 的检测与启动。
 * 工作台与模型管理页共用这一份逻辑：检测失败只在界面上显示「未运行」，
 * 只有用户主动点「启动本地模型」失败时才展示具体原因（安装缺失、启动超时等）。
 */
export function useOllamaControl() {
  const status = ref<OllamaStatus | null>(null);
  const starting = ref(false);
  // 「重新检测」自身的 loading：与启动分开，避免启动时检测按钮也转圈。
  const refreshing = ref(false);
  const error = ref("");

  /** 静默重新探测：用于首屏和「重新检测」，失败不打扰用户。 */
  async function refresh(): Promise<void> {
    refreshing.value = true;
    try {
      status.value = await runtimeService.checkOllama();
    } catch {
      status.value = null;
    } finally {
      refreshing.value = false;
    }
  }

  /** 启动本地模型并等待服务就绪；返回是否成功，失败原因写进 error。 */
  async function start(): Promise<boolean> {
    starting.value = true;
    error.value = "";
    try {
      status.value = await runtimeService.startOllama();
      return status.value.running;
    } catch (err) {
      error.value = String(err);
      // 启动失败后补一次检测，界面至少能反映「仍未运行」的真实状态。
      await refresh();
      return false;
    } finally {
      starting.value = false;
    }
  }

  return { status, starting, refreshing, error, refresh, start };
}
