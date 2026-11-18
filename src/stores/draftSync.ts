import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * 章节正文的跨页版本号。
 *
 * 审稿页把修改写回某章正文后在这里 +1；写作台从 keep-alive 缓存回来时比对版本，
 * 不一致就重读正文。没有这一步，缓存里的旧正文会被自动保存重新写回去，
 * 表现为「审稿里点了应用，回写作台却看不到改动」。
 */
export const useDraftSyncStore = defineStore("draftSync", () => {
  const revisions = ref<Record<string, number>>({});

  function bump(chapterId: string): void {
    revisions.value = {
      ...revisions.value,
      [chapterId]: (revisions.value[chapterId] ?? 0) + 1,
    };
  }

  function revisionOf(chapterId: string): number {
    return revisions.value[chapterId] ?? 0;
  }

  return { revisions, bump, revisionOf };
});
