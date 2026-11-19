import { storeToRefs } from "pinia";
import { computed, ref, type Ref } from "vue";
import { loadActCount, resolveActCount } from "@/services/outlineActService";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import { useProjectStore } from "@/stores/project";
import type { Act, Chapter, ChapterStatus, Project } from "@/types";

/**
 * 写作台的章节列表与幕次：加载快照、就地更新、建章、阶段推进。
 *
 * 从 useWritingDesk 拆出以控制单文件规模。这里只管「章节元数据」，
 * 不碰正文与自动保存；正文写入后的阶段推进通过 markDraftingStage 提供，
 * 由调用方在保存成功后触发。
 */
export function useWritingChapters(projectId: string, deps: { error: Ref<string> }) {
  // 当前作品来自全局 store：别的页面改了作品状态，这里能立刻看到。
  const project = storeToRefs(useProjectStore()).current;
  const chapters = ref<Chapter[]>([]);
  const chaptersLoading = ref(true);
  /** 章节列表要渲染的幕数：与大纲页共用 app_meta 里的幕数，新增幕在这里也能选到。 */
  const actCount = ref(3);

  const totalWords = computed(() =>
    chapters.value.reduce((sum, chapter) => sum + chapter.wordCount, 0),
  );
  const chaptersByAct = computed(() =>
    Array.from({ length: actCount.value }, (_, index) => {
      const act = index + 1;
      return {
        act,
        chapters: chapters.value.filter((chapter) => chapter.act === act),
      };
    }),
  );

  /**
   * 首次写出正文后，把作品阶段从「大纲」推进到「初稿」。
   * 阶段标签只是顶栏进度提示，写失败保持原状即可，不影响正文保存。
   */
  async function markDraftingStage(): Promise<void> {
    const current = project.value;
    if (current?.status !== "outline") return;
    try {
      const next: Project = { ...current, status: "drafting" };
      await projectService.update(next);
      project.value = next;
    } catch {
      // 忽略：阶段推进失败时用户仍能正常写作。
    }
  }

  /** 章节列表里的字数/状态就地更新，避免每次自动保存都重拉整份快照。 */
  function patchChapter(
    chapterId: string,
    patch: { wordCount?: number; status?: ChapterStatus; summary?: string },
  ) {
    // 显式传 undefined 表示「这轮不改这个字段」，不能写进对象：
    // 否则状态会变成 undefined，下一次整对象提交章节时后端会因为缺字段而报错。
    const clean: Partial<Pick<Chapter, "wordCount" | "status" | "summary">> = { ...patch };
    if (patch.status === undefined) delete clean.status;
    if (patch.wordCount === undefined) delete clean.wordCount;
    if (patch.summary === undefined) delete clean.summary;
    chapters.value = chapters.value.map((chapter) =>
      chapter.id === chapterId ? { ...chapter, ...clean } : chapter,
    );
  }

  /**
   * 取一次章节快照。
   * `silent` 用于「从大纲页回来」的刷新：章节列表已经渲染着，不该整块闪成加载态。
   */
  async function loadChapters(options: { silent?: boolean } = {}): Promise<void> {
    if (!options.silent) chaptersLoading.value = true;
    try {
      const snapshot = await outlineService.snapshot(projectId);
      chapters.value = snapshot.chapters;
      // 与大纲页共用同一份幕数：作者在大纲里新增的幕，写作台也能建章进去。
      const stored = await loadActCount(projectId);
      actCount.value = resolveActCount(stored, snapshot.chapters);
    } catch (err) {
      deps.error.value = `读取章节失败：${String(err)}`;
    } finally {
      if (!options.silent) chaptersLoading.value = false;
    }
  }

  /**
   * 写作台直接建章：只补最小字段（幕、标题、梗概、状态），
   * 创建后刷新列表并由页面跳到新章开始写。
   */
  async function createChapter(input: {
    act: Act;
    title: string;
    summary?: string;
    /** 状态由弹窗传入，未传时按「待写」处理，和大纲页的默认值保持一致。 */
    status?: ChapterStatus;
  }): Promise<Chapter | null> {
    try {
      const chapter = await outlineService.createChapter({
        projectId,
        act: input.act,
        title: input.title,
        summary: input.summary ?? "",
        status: input.status ?? "planned",
      });
      await loadChapters();
      return chapter;
    } catch (err) {
      deps.error.value = `创建章节失败：${String(err)}`;
      return null;
    }
  }

  return {
    project,
    chapters,
    chaptersLoading,
    actCount,
    totalWords,
    chaptersByAct,
    markDraftingStage,
    patchChapter,
    loadChapters,
    createChapter,
  };
}
