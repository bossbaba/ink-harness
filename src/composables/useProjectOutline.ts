import { storeToRefs } from "pinia";
import { computed, onMounted, ref } from "vue";
import { loadActCount, resolveActCount, saveActCount } from "@/services/outlineActService";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import { useProjectStore } from "@/stores/project";
import {
  type Act,
  type Chapter,
  type ChapterDraft,
  DEFAULT_ACT_COUNT,
  MAX_ACTS,
  type Project,
  type Scene,
  type SceneDraft,
} from "@/types";
import { normalizeError } from "@/utils/errors";
import { onReactivated } from "@/utils/lifecycle";
import { useForeshadows } from "./useForeshadows";

function emptyChapterDraft(act: Act = 1): ChapterDraft {
  return { id: "", act, title: "", summary: "", status: "planned" };
}

function emptySceneDraft(chapterId = ""): SceneDraft {
  return { id: "", chapterId, title: "", pov: "", location: "", timeMark: "", summary: "" };
}

/**
 * 作品大纲：projectId 来自路由参数，缺失时停止取数。
 * 页面只负责组装；排序、CRUD 与上下文生成都在这里统一处理。
 */
export function useProjectOutline(projectIdFromRoute: string) {
  const projectId = ref(projectIdFromRoute);
  // 当前作品来自全局 store：别的页面改了作品状态，这里能立刻看到。
  const project = storeToRefs(useProjectStore()).current;
  const chapters = ref<Chapter[]>([]);
  const scenes = ref<Scene[]>([]);
  const activeChapterId = ref("");
  const error = ref("");
  const busy = ref(false);
  // 看板要渲染的幕数：默认三幕，作者可继续新增（空幕也保留）。
  const actCount = ref(DEFAULT_ACT_COUNT);

  // 三个编辑弹窗各自持有草稿，弹窗组件本身不存业务状态。
  const chapterShow = ref(false);
  const chapterIsNew = ref(true);
  const chapterDraft = ref<ChapterDraft>(emptyChapterDraft());
  const sceneShow = ref(false);
  const sceneIsNew = ref(true);
  const sceneDraft = ref<SceneDraft>(emptySceneDraft());

  // 伏笔管理委托给独立 composable：写操作后 reload 统一刷新大纲快照。
  const foreshadowsApi = useForeshadows({
    projectId,
    chapters,
    error,
    busy,
    reload: () => load(),
  });
  const {
    foreshadows,
    setForeshadows,
    foreshadowShow,
    foreshadowDraft,
    foreshadowTags,
    chapterOptions,
    openCreateForeshadow,
    saveForeshadow,
    patchForeshadow,
    removeForeshadow,
  } = foreshadowsApi;

  const contextShow = ref(false);
  const contextText = ref("");
  const contextBusy = ref(false);

  const projectTitle = computed(() => project.value?.title ?? "");

  /** 章节 id → 场景列表，保持后端返回的排序。 */
  const scenesByChapter = computed<Record<string, Scene[]>>(() => {
    const map: Record<string, Scene[]> = {};
    for (const scene of scenes.value) {
      const list = map[scene.chapterId] ?? [];
      list.push(scene);
      map[scene.chapterId] = list;
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  });

  const chapterTitleById = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const chapter of chapters.value) map[chapter.id] = chapter.title;
    return map;
  });

  const stats = computed(() => ({
    chapters: chapters.value.length,
    scenes: scenes.value.length,
    pendingForeshadows: foreshadows.value.filter((item) => item.status !== "paid-off").length,
  }));

  async function load(): Promise<void> {
    if (!projectId.value) {
      error.value = "缺少作品 ID，无法打开大纲。";
      return;
    }
    try {
      const snapshot = await outlineService.snapshot(projectId.value);
      chapters.value = snapshot.chapters;
      scenes.value = snapshot.scenes;
      setForeshadows(snapshot.foreshadows);
      // 空幕数存在 app_meta；章节里出现的更大幕次也要算进来，避免读到旧数据时少渲染一幕。
      const stored = await loadActCount(projectId.value);
      actCount.value = resolveActCount(stored, snapshot.chapters);
      if (!snapshot.chapters.some((chapter) => chapter.id === activeChapterId.value)) {
        activeChapterId.value = "";
      }
    } catch (err) {
      error.value = `读取大纲失败：${String(err)}`;
    }
  }

  /** 首次进入大纲说明作品已从构思推进到大纲阶段；失败不阻断编辑。 */
  async function markOutlineStage(): Promise<void> {
    const current = project.value;
    if (current?.status !== "idea") return;
    try {
      const next: Project = { ...current, status: "outline" };
      await projectService.update(next);
      project.value = next;
    } catch {
      // 阶段标签只是辅助信息，写失败时保持原状即可。
    }
  }

  function selectChapter(id: string): void {
    activeChapterId.value = activeChapterId.value === id ? "" : id;
  }

  function openCreateChapter(act: Act): void {
    chapterIsNew.value = true;
    chapterDraft.value = emptyChapterDraft(act);
    chapterShow.value = true;
    error.value = "";
  }

  /**
   * 新增一幕：空幕没有章节承载，必须先把幕数落库；
   * 落库后直接打开这一幕的建章弹窗，作者不用再点一次「新增章节」。
   */
  async function addAct(): Promise<void> {
    if (actCount.value >= MAX_ACTS) {
      error.value = `最多支持 ${MAX_ACTS} 幕`;
      return;
    }
    actCount.value += 1;
    try {
      if (projectId.value) await saveActCount(projectId.value, actCount.value);
    } catch (err) {
      error.value = `保存幕数失败：${String(err)}`;
    }
    openCreateChapter(actCount.value);
  }

  /** 只允许移除「末尾且没有任何章节」的幕，避免误删正在写的章节。 */
  async function removeAct(act: Act): Promise<void> {
    if (act !== actCount.value) return;
    if (chapters.value.some((chapter) => chapter.act === act)) return;
    actCount.value = Math.max(1, actCount.value - 1);
    try {
      if (projectId.value) await saveActCount(projectId.value, actCount.value);
    } catch (err) {
      error.value = `保存幕数失败：${String(err)}`;
    }
  }

  function openEditChapter(chapter: Chapter): void {
    chapterIsNew.value = false;
    chapterDraft.value = {
      id: chapter.id,
      act: chapter.act,
      title: chapter.title,
      summary: chapter.summary,
      status: chapter.status,
    };
    chapterShow.value = true;
    error.value = "";
  }

  async function saveChapter(): Promise<void> {
    const draft = chapterDraft.value;
    if (!draft.title.trim()) {
      error.value = "请输入章节标题";
      return;
    }
    if (!projectId.value) return;
    busy.value = true;
    error.value = "";
    try {
      if (chapterIsNew.value) {
        await outlineService.createChapter({
          projectId: projectId.value,
          act: draft.act,
          title: draft.title,
          summary: draft.summary,
          status: draft.status,
        });
      } else {
        const current = chapters.value.find((chapter) => chapter.id === draft.id);
        if (!current) return;
        await outlineService.updateChapter({
          ...current,
          act: draft.act,
          title: draft.title,
          summary: draft.summary,
          status: draft.status,
        });
      }
      chapterShow.value = false;
      await load();
      await markOutlineStage();
    } catch (err) {
      const info = normalizeError(err);
      if (info.code === "conflict") {
        // 缓存里的章节已被别处改过：重取最新版，弹窗保持打开，让作者确认后再存。
        await load();
        error.value = `${info.message}（已刷新为最新内容，请确认后再保存）`;
      } else {
        error.value = info.message;
      }
    } finally {
      busy.value = false;
    }
  }

  async function removeChapter(chapter: Chapter): Promise<void> {
    busy.value = true;
    error.value = "";
    try {
      await outlineService.removeChapter(chapter.id);
      if (activeChapterId.value === chapter.id) activeChapterId.value = "";
      await load();
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  function openCreateScene(chapter: Chapter): void {
    sceneIsNew.value = true;
    sceneDraft.value = emptySceneDraft(chapter.id);
    sceneShow.value = true;
    error.value = "";
  }

  function openEditScene(scene: Scene): void {
    sceneIsNew.value = false;
    sceneDraft.value = {
      id: scene.id,
      chapterId: scene.chapterId,
      title: scene.title,
      pov: scene.pov,
      location: scene.location,
      timeMark: scene.timeMark,
      summary: scene.summary,
    };
    sceneShow.value = true;
    error.value = "";
  }

  async function saveScene(): Promise<void> {
    const draft = sceneDraft.value;
    if (!draft.title.trim()) {
      error.value = "请输入场景标题";
      return;
    }
    busy.value = true;
    error.value = "";
    try {
      if (sceneIsNew.value) {
        await outlineService.createScene({
          chapterId: draft.chapterId,
          title: draft.title,
          pov: draft.pov,
          location: draft.location,
          timeMark: draft.timeMark,
          summary: draft.summary,
        });
      } else {
        const current = scenes.value.find((scene) => scene.id === draft.id);
        if (!current) return;
        await outlineService.updateScene({
          ...current,
          title: draft.title,
          pov: draft.pov,
          location: draft.location,
          timeMark: draft.timeMark,
          summary: draft.summary,
        });
      }
      sceneShow.value = false;
      await load();
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  async function removeScene(scene: Scene): Promise<void> {
    busy.value = true;
    error.value = "";
    try {
      await outlineService.removeScene(scene.id);
      await load();
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  async function moveChapter(chapterId: string, act: Act, index: number): Promise<void> {
    if (!projectId.value) return;
    busy.value = true;
    error.value = "";
    try {
      await outlineService.moveChapter({
        projectId: projectId.value,
        chapterId,
        targetAct: act,
        targetIndex: index,
      });
      await load();
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  async function moveScene(
    sceneId: string,
    _fromChapterId: string,
    toChapterId: string,
    index: number,
  ): Promise<void> {
    busy.value = true;
    error.value = "";
    try {
      await outlineService.moveScene({
        sceneId,
        targetChapterId: toChapterId,
        targetIndex: index,
      });
      await load();
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  async function openContext(): Promise<void> {
    contextShow.value = true;
    contextBusy.value = true;
    try {
      contextText.value = await outlineService.buildContext(projectId.value);
    } catch (err) {
      contextText.value = `生成上下文失败：${String(err)}`;
    } finally {
      contextBusy.value = false;
    }
  }

  onMounted(async () => {
    if (!projectIdFromRoute) {
      error.value = "缺少作品 ID，无法打开大纲。";
      return;
    }
    try {
      const found = await projectService.get(projectIdFromRoute);
      if (!found) {
        error.value = "作品不存在或已删除。";
        return;
      }
      project.value = found;
      await load();
    } catch (err) {
      error.value = `读取作品失败：${String(err)}`;
    }
  });

  // 构思向导会写回大纲，写作台也会增删章节：从缓存回来时重拉一次，
  // load() 会保留仍然存在的选中章节，不会把作者正在编辑的章跳走。
  onReactivated(() => void load());

  return {
    projectId,
    projectTitle,
    chapters,
    scenes,
    foreshadows,
    activeChapterId,
    error,
    busy,
    actCount,
    chapterShow,
    chapterIsNew,
    chapterDraft,
    sceneShow,
    sceneIsNew,
    sceneDraft,
    foreshadowShow,
    foreshadowDraft,
    contextShow,
    contextText,
    contextBusy,
    scenesByChapter,
    foreshadowTags,
    chapterOptions,
    chapterTitleById,
    stats,
    selectChapter,
    addAct,
    removeAct,
    openCreateChapter,
    openEditChapter,
    saveChapter,
    removeChapter,
    openCreateScene,
    openEditScene,
    saveScene,
    removeScene,
    openCreateForeshadow,
    saveForeshadow,
    patchForeshadow,
    removeForeshadow,
    moveChapter,
    moveScene,
    openContext,
  };
}
