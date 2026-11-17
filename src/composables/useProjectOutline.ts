import { computed, onMounted, ref } from "vue";
import { outlineService } from "@/services/outlineService";
import { projectService } from "@/services/projectService";
import type {
  Act,
  Chapter,
  ChapterDraft,
  Foreshadow,
  ForeshadowDraft,
  Project,
  Scene,
  SceneDraft,
} from "@/types";
import { onReactivated } from "@/utils/lifecycle";

function emptyChapterDraft(act: Act = 1): ChapterDraft {
  return { id: "", act, title: "", summary: "", status: "planned" };
}

function emptySceneDraft(chapterId = ""): SceneDraft {
  return { id: "", chapterId, title: "", pov: "", location: "", timeMark: "", summary: "" };
}

function emptyForeshadowDraft(): ForeshadowDraft {
  return { title: "", setupChapterId: "", payoffChapterId: "", status: "planned" };
}

/**
 * 作品大纲：projectId 来自路由参数，缺失时停止取数。
 * 页面只负责组装；排序、CRUD 与上下文生成都在这里统一处理。
 */
export function useProjectOutline(projectIdFromRoute: string) {
  const projectId = ref(projectIdFromRoute);
  const project = ref<Project | null>(null);
  const chapters = ref<Chapter[]>([]);
  const scenes = ref<Scene[]>([]);
  const foreshadows = ref<Foreshadow[]>([]);
  const activeChapterId = ref("");
  const error = ref("");
  const busy = ref(false);

  // 三个编辑弹窗各自持有草稿，弹窗组件本身不存业务状态。
  const chapterShow = ref(false);
  const chapterIsNew = ref(true);
  const chapterDraft = ref<ChapterDraft>(emptyChapterDraft());
  const sceneShow = ref(false);
  const sceneIsNew = ref(true);
  const sceneDraft = ref<SceneDraft>(emptySceneDraft());
  const foreshadowShow = ref(false);
  const foreshadowDraft = ref<ForeshadowDraft>(emptyForeshadowDraft());

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

  /** 章节 id → 伏笔标签，用于在章节/场景卡片上标记铺设与回收。 */
  const foreshadowTags = computed<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    const push = (chapterId: string | null, label: string) => {
      if (!chapterId) return;
      const list = map[chapterId] ?? [];
      list.push(label);
      map[chapterId] = list;
    };
    for (const item of foreshadows.value) {
      push(item.setupChapterId, `伏笔·铺设 ${item.title}`);
      push(item.payoffChapterId, `伏笔·回收 ${item.title}`);
    }
    return map;
  });

  /** 伏笔面板的章节下拉：带上幕次前缀，避免同名章节混淆。 */
  const chapterOptions = computed(() =>
    chapters.value.map((chapter) => ({
      label: `第${chapter.act}幕 · ${chapter.sortOrder + 1}. ${chapter.title}`,
      value: chapter.id,
    })),
  );

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
      foreshadows.value = snapshot.foreshadows;
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
      error.value = String(err);
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

  function openCreateForeshadow(): void {
    foreshadowDraft.value = emptyForeshadowDraft();
    foreshadowShow.value = true;
    error.value = "";
  }

  async function saveForeshadow(): Promise<void> {
    const draft = foreshadowDraft.value;
    if (!draft.title.trim()) {
      error.value = "请输入伏笔标题";
      return;
    }
    if (!projectId.value) return;
    busy.value = true;
    error.value = "";
    try {
      await outlineService.createForeshadow({
        projectId: projectId.value,
        title: draft.title,
        setupChapterId: draft.setupChapterId || null,
        payoffChapterId: draft.payoffChapterId || null,
        status: draft.status,
      });
      foreshadowShow.value = false;
      await load();
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  /** 伏笔面板的就地编辑：只提交发生变化的字段。 */
  async function patchForeshadow(
    foreshadow: Foreshadow,
    patch: Partial<Pick<Foreshadow, "setupChapterId" | "payoffChapterId" | "status">>,
  ): Promise<void> {
    busy.value = true;
    error.value = "";
    try {
      await outlineService.updateForeshadow({ ...foreshadow, ...patch });
      await load();
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  async function removeForeshadow(foreshadow: Foreshadow): Promise<void> {
    busy.value = true;
    error.value = "";
    try {
      await outlineService.removeForeshadow(foreshadow.id);
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
