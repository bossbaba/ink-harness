import { defineStore } from "pinia";
import { ref } from "vue";
import type { Project } from "@/types";

/**
 * 当前作品：全应用唯一一份。
 *
 * 之前 shell + 5 个 composable 各存一个 `ref<Project|null>`，keep-alive 下互不通知，
 * 典型表现是「大纲页改了作品状态，回写作台顶栏还是旧值」。
 * 现在所有页面写的是同一份数据，shell 也能直接显示作品名。
 */
export const useProjectStore = defineStore("project", () => {
  const current = ref<Project | null>(null);

  /** 整体替换（加载完成或切作品时用）。 */
  function set(project: Project | null): void {
    current.value = project;
  }

  /** 就地合并字段（保存后后端回传的新状态用这个，避免整对象替换丢失并发改动）。 */
  function patch(changes: Partial<Project>): void {
    if (!current.value) return;
    current.value = { ...current.value, ...changes };
  }

  function clear(): void {
    current.value = null;
  }

  return { current, set, patch, clear };
});
