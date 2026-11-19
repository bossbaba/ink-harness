import { computed, ref, type Ref } from "vue";
import { outlineService } from "@/services/outlineService";
import { actLabel, type Chapter, type Foreshadow, type ForeshadowDraft } from "@/types";

/**
 * 作品大纲的伏笔管理：列表、铺设/回收标签、章节下拉，以及增删改。
 *
 * 从 useProjectOutline 拆出以控制单文件规模。伏笔状态与大纲其余部分
 * 通过入参注入（projectId / chapters / 共享 error、busy 与 reload 回调），
 * 写操作完成后由调用方统一 reload，保证一份快照 reload 就刷新全部面板。
 */
export function useForeshadows(deps: {
  projectId: Ref<string>;
  chapters: Ref<Chapter[]>;
  error: Ref<string>;
  busy: Ref<boolean>;
  reload: () => Promise<void>;
}) {
  const foreshadows = ref<Foreshadow[]>([]);
  const foreshadowShow = ref(false);
  const foreshadowDraft = ref<ForeshadowDraft>({
    title: "",
    setupChapterId: "",
    payoffChapterId: "",
    status: "planned",
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
    deps.chapters.value.map((chapter) => ({
      label: `${actLabel(chapter.act)} · ${chapter.sortOrder + 1}. ${chapter.title}`,
      value: chapter.id,
    })),
  );

  function openCreateForeshadow(): void {
    foreshadowDraft.value = {
      title: "",
      setupChapterId: "",
      payoffChapterId: "",
      status: "planned",
    };
    foreshadowShow.value = true;
    deps.error.value = "";
  }

  async function saveForeshadow(): Promise<void> {
    const draft = foreshadowDraft.value;
    if (!draft.title.trim()) {
      deps.error.value = "请输入伏笔标题";
      return;
    }
    if (!deps.projectId.value) return;
    deps.busy.value = true;
    deps.error.value = "";
    try {
      await outlineService.createForeshadow({
        projectId: deps.projectId.value,
        title: draft.title,
        setupChapterId: draft.setupChapterId || null,
        payoffChapterId: draft.payoffChapterId || null,
        status: draft.status,
      });
      foreshadowShow.value = false;
      await deps.reload();
    } catch (err) {
      deps.error.value = String(err);
    } finally {
      deps.busy.value = false;
    }
  }

  /** 伏笔面板的就地编辑：只提交发生变化的字段。 */
  async function patchForeshadow(
    foreshadow: Foreshadow,
    patch: Partial<Pick<Foreshadow, "setupChapterId" | "payoffChapterId" | "status">>,
  ): Promise<void> {
    deps.busy.value = true;
    deps.error.value = "";
    try {
      await outlineService.updateForeshadow({ ...foreshadow, ...patch });
      await deps.reload();
    } catch (err) {
      deps.error.value = String(err);
    } finally {
      deps.busy.value = false;
    }
  }

  async function removeForeshadow(foreshadow: Foreshadow): Promise<void> {
    deps.busy.value = true;
    deps.error.value = "";
    try {
      await outlineService.removeForeshadow(foreshadow.id);
      await deps.reload();
    } catch (err) {
      deps.error.value = String(err);
    } finally {
      deps.busy.value = false;
    }
  }

  /** 大纲快照 reload 后回填伏笔列表。 */
  function setForeshadows(items: Foreshadow[]): void {
    foreshadows.value = items;
  }

  return {
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
  };
}
