import { defineStore } from "pinia";
import { ref, watch } from "vue";

export type Appearance = "light" | "dark";

const STORAGE_KEY = "ink-harness.appearance";

/** 全局 UI 状态：明暗主题、专注模式、Copilot 面板开合。 */
export const useAppStore = defineStore("app", () => {
  const saved = (localStorage.getItem(STORAGE_KEY) as Appearance | null) ?? "light";
  const appearance = ref<Appearance>(saved);
  const focusMode = ref(false);
  // 写作台的 AI 对话是页面第三栏（不是浮层），默认展开；不想要时可以收起让正文更宽。
  const copilotOpen = ref(true);

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

  // 进专注前记下对话栏是否展开，退出时按原样恢复，免得每次写完都要手动点开。
  let copilotBeforeFocus = copilotOpen.value;

  function toggleFocusMode() {
    focusMode.value = !focusMode.value;
    if (focusMode.value) {
      copilotBeforeFocus = copilotOpen.value;
      copilotOpen.value = false;
    } else {
      copilotOpen.value = copilotBeforeFocus;
    }
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
