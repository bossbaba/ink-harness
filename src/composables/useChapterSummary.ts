import { computed, ref } from "vue";
import { outlineService } from "@/services/outlineService";
import {
  AUTO_SUMMARY_CHARS,
  loadSummaryMeta,
  requestChapterSummary,
  SUMMARY_STALE_CHARS,
  type SummaryMeta,
  saveSummaryMeta,
} from "@/services/summaryService";
import type { Chapter, Project } from "@/types";

export interface ChapterSummaryOptions {
  project: () => Project | null;
  chapter: () => Chapter | null;
  /** 当前正文纯文本，用内存里的稿子而不是库里的旧内容。 */
  text: () => string;
  /** 写回成功后通知页面同步章节列表，避免 AI 还拿到旧梗概。 */
  onPersisted?: (value: string) => void;
}

/**
 * 章节摘要：把长章压成一段可注入 AI 的「记忆」，正文改动多了就提醒更新。
 * 摘要本体存在 chapter.summary（本来就参与上下文组装），基线字数存 app_meta，
 * 两者都不需要新增数据表或 IPC 命令。
 */
export function useChapterSummary(options: ChapterSummaryOptions) {
  const summary = ref("");
  const meta = ref<SummaryMeta | null>(null);
  const generating = ref(false);
  const saving = ref(false);
  const received = ref(0);
  const error = ref("");

  /** 正文比生成摘要时多出的字数；负数按 0 处理（回退版本时不显示「过期 -N 字」）。 */
  const staleChars = computed(() => {
    const chapter = options.chapter();
    if (!chapter || !meta.value) return 0;
    return Math.max(0, chapter.wordCount - meta.value.wordCount);
  });
  const isStale = computed(() => staleChars.value >= SUMMARY_STALE_CHARS);
  const shouldAutoUpdate = computed(() => staleChars.value >= AUTO_SUMMARY_CHARS);

  async function load(): Promise<void> {
    const chapter = options.chapter();
    error.value = "";
    if (!chapter) {
      summary.value = "";
      meta.value = null;
      return;
    }
    summary.value = chapter.summary ?? "";
    meta.value = await loadSummaryMeta(chapter.id);
  }

  /** 把摘要与基线一起写回去；手动编辑和自动生成走同一条持久化路径。 */
  async function persist(value: string): Promise<void> {
    const chapter = options.chapter();
    const project = options.project();
    if (!chapter || !project) return;
    saving.value = true;
    try {
      // 只写摘要字段：摘要会被自动更新，不能顺手把整份章节（标题/幕次/状态）写回去，
      // 否则会用缓存里的旧值覆盖正文保存刚推进的状态。作品 id 必须显式传，后端据此核归属。
      await outlineService.updateChapterSummary(chapter.id, value, project.id);
      const next: SummaryMeta = {
        wordCount: chapter.wordCount,
        generatedAt: new Date().toISOString(),
        model: meta.value?.model ?? "",
      };
      await saveSummaryMeta(chapter.id, next);
      summary.value = value;
      meta.value = next;
      options.onPersisted?.(value);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      saving.value = false;
    }
  }

  async function regenerate(): Promise<void> {
    const project = options.project();
    const chapter = options.chapter();
    if (!project || !chapter || generating.value) return;
    generating.value = true;
    error.value = "";
    received.value = 0;
    try {
      const text = options.text().trim();
      if (!text) throw new Error("本章还没有正文，先写一点再来生成摘要。");
      // 摘要要写清「埋下/回收了什么伏笔」，必须先把作品上下文取来一起送进去。
      const context = await outlineService.buildContext(project.id);
      const value = await requestChapterSummary(
        {
          project,
          chapter,
          text,
          privacy: project.privacy,
          projectId: project.id,
          context,
        },
        (count) => {
          received.value = count;
        },
      );
      await persist(value);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      generating.value = false;
    }
  }

  return {
    summary,
    meta,
    generating,
    saving,
    received,
    error,
    staleChars,
    isStale,
    shouldAutoUpdate,
    load,
    persist,
    regenerate,
  };
}
