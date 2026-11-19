import { type Ref, ref } from "vue";
import { modelRouter } from "@/services/modelRouter";
import {
  SETTING_DEFAULT_MODEL,
  SETTING_ROUTE_STRATEGY,
  SETTING_STOP_OLLAMA_ON_EXIT,
  settingsService,
} from "@/services/settingsService";
import type { RouteStrategy } from "@/types";

/**
 * 模型相关的应用级设置：退出时是否停掉本地模型、全局任务路由策略。
 *
 * 两者都是「读写一条设置 + 失败回滚」的开关，和 Provider CRUD 无关，
 * 单独成 composable 便于单测与复用。
 */
export function useAppSettings(shared: { error: Ref<string> }) {
  /** 退出应用时是否停掉本地模型（只影响本应用拉起的实例），默认开。 */
  const stopOllamaOnExit = ref(true);
  /** 全局任务路由策略，影响所有 AI 动作选模型的偏好。 */
  const routeStrategy = ref<RouteStrategy>("quality");
  /** 默认生成模型标识 `providerId:modelId`，空串表示按策略自动选。 */
  const defaultModel = ref("");
  const savingSetting = ref(false);

  async function loadStopOnExit(): Promise<void> {
    stopOllamaOnExit.value = await settingsService.getBool(SETTING_STOP_OLLAMA_ON_EXIT, true);
  }

  /**
   * 切换「退出时停止本地模型」。
   * 先改界面再落库；写失败要回滚开关，否则界面显示的和实际生效的不一致。
   */
  async function setStopOllamaOnExit(value: boolean): Promise<void> {
    const previous = stopOllamaOnExit.value;
    stopOllamaOnExit.value = value;
    savingSetting.value = true;
    shared.error.value = "";
    try {
      await settingsService.setBool(SETTING_STOP_OLLAMA_ON_EXIT, value);
    } catch (err) {
      stopOllamaOnExit.value = previous;
      shared.error.value = `保存设置失败：${String(err)}`;
    } finally {
      savingSetting.value = false;
    }
  }

  async function loadRouteStrategy(): Promise<void> {
    const value = await settingsService.getString(SETTING_ROUTE_STRATEGY);
    if (value === "quality" || value === "cost" || value === "privacy") {
      routeStrategy.value = value;
    }
    // 策略存在设置里，路由缓存也要跟着刷新一次；
    // 刷新失败不应让整页挂载变成 unhandled rejection。
    await modelRouter.refresh().catch(() => undefined);
  }

  async function setRouteStrategy(value: RouteStrategy): Promise<void> {
    const previous = routeStrategy.value;
    routeStrategy.value = value;
    savingSetting.value = true;
    shared.error.value = "";
    try {
      await modelRouter.setStrategy(value);
    } catch (err) {
      routeStrategy.value = previous;
      shared.error.value = `保存路由策略失败：${String(err)}`;
    } finally {
      savingSetting.value = false;
    }
  }

  async function loadDefaultModel(): Promise<void> {
    defaultModel.value = await settingsService.getString(SETTING_DEFAULT_MODEL);
  }

  /** 切换默认模型：先改界面再落库，失败回滚，避免出现显示与生效不一致。 */
  async function setDefaultModel(value: string): Promise<void> {
    const previous = defaultModel.value;
    defaultModel.value = value;
    savingSetting.value = true;
    shared.error.value = "";
    try {
      await modelRouter.setDefaultModel(value);
    } catch (err) {
      defaultModel.value = previous;
      shared.error.value = `保存默认模型失败：${String(err)}`;
    } finally {
      savingSetting.value = false;
    }
  }

  return {
    stopOllamaOnExit,
    routeStrategy,
    defaultModel,
    savingSetting,
    loadStopOnExit,
    setStopOllamaOnExit,
    loadRouteStrategy,
    setRouteStrategy,
    loadDefaultModel,
    setDefaultModel,
  };
}
