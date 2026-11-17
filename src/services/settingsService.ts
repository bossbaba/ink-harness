import { tauriApi } from "@/api/tauri";

/** 退出应用时停止「由本应用拉起」的本地 Ollama，默认开启。 */
export const SETTING_STOP_OLLAMA_ON_EXIT = "stop_ollama_on_exit";

/** RAG 检索用的 embedding 模型，值形如 `providerId:modelId`。 */
export const SETTING_RAG_MODEL = "rag_embedding_model";

/**
 * 应用级设置的薄封装：后端只认字符串，布尔值统一编码成 "1"/"0"。
 * 读取失败一律回落到调用方给的默认值，避免设置读不出来导致界面卡住。
 */
export const settingsService = {
  async getBool(key: string, fallback: boolean): Promise<boolean> {
    try {
      const raw = await tauriApi.getAppSetting(key);
      if (raw === null) return fallback;
      return raw === "1" || raw.toLowerCase() === "true";
    } catch {
      return fallback;
    }
  },

  setBool(key: string, value: boolean): Promise<void> {
    return tauriApi.setAppSetting(key, value ? "1" : "0");
  },

  /** 字符串设置；读不到时返回空串，调用方按「未设置」处理。 */
  async getString(key: string): Promise<string> {
    try {
      return (await tauriApi.getAppSetting(key)) ?? "";
    } catch {
      return "";
    }
  },

  setString(key: string, value: string): Promise<void> {
    return tauriApi.setAppSetting(key, value);
  },
};
