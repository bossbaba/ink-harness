import { defineStore } from "pinia";
import { ref, watch } from "vue";

export type Appearance = "light" | "dark";

const STORAGE_KEY = "ink-harness.appearance";

/** 全局 UI 状态：明暗主题、专注模式、Copilot 面板开合。 */
export const useAppStore = defineStore("app", () => {
  const saved = (localStorage.getItem(STORAGE_KEY) as Appearance | null) ?? "light";
  const appearance = ref<Appearance>(saved);
  const focusMode = ref(false);
  // 写作台的 AI 对话默认收起：抽屉宽 380px，一进页面就弹出会挡住正文。
  const copilotOpen = ref(false);

  watch(appearance, (value) => {
    localStorage.setItem(STORAGE_KEY, value);
    document.documentElement.dataset.appearance = value;
  });

  function initAppearance() {
    document.documentElement.dataset.appearance = appearance.value;
  }

  function toggleAppearance() {
    appearance.value = appearance.value === "light" ? "dark" : "light";
  }

  function toggleFocusMode() {
    focusMode.value = !focusMode.value;
    if (focusMode.value) copilotOpen.value = false;
  }

  function toggleCopilot() {
    copilotOpen.value = !copilotOpen.value;
  }

  return {
    appearance,
    focusMode,
    copilotOpen,
    initAppearance,
    toggleAppearance,
    toggleFocusMode,
    toggleCopilot,
  };
});
