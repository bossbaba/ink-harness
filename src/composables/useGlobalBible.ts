import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { projectService } from "@/services/projectService";
import { storyElementService } from "@/services/storyElementService";
import {
  type Project,
  STORY_KIND_LABEL,
  STORY_KIND_OPTIONS,
  type StoryElementKind,
  type StoryElementOverview,
} from "@/types";
import { onReactivated } from "@/utils/lifecycle";

type KindFilter = StoryElementKind | "all";

/** 全局设定库：跨作品只读汇总，编辑一律跳到作品内页面。 */
export function useGlobalBible() {
  const route = useRoute();
  const router = useRouter();

  const items = ref<StoryElementOverview[]>([]);
  const projects = ref<Project[]>([]);
  const projectFilter = ref("");
  const filterKind = ref<KindFilter>("all");
  const keyword = ref("");
  const selectedId = ref("");
  const error = ref("");
  const busy = ref(false);

  const kindOptions = computed(() => [
    { label: "全部类型", value: "all" as const },
    ...STORY_KIND_OPTIONS.map((option) => ({
      label: option.label,
      value: option.value as KindFilter,
    })),
  ]);

  const projectOptions = computed(() => [
    { label: "全部作品", value: "" },
    ...projects.value.map((project) => ({ label: project.title, value: project.id })),
  ]);

  const filtered = computed(() => {
    const term = keyword.value.trim().toLowerCase();
    return items.value.filter((item) => {
      if (projectFilter.value && item.projectId !== projectFilter.value) return false;
      if (filterKind.value !== "all" && item.kind !== filterKind.value) return false;
      if (!term) return true;
      const aliases = item.detail.aliases ?? [];
      return [item.name, item.summary, item.projectTitle, ...aliases]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  });

  const selected = computed<StoryElementOverview | null>(
    () => items.value.find((item) => item.id === selectedId.value) ?? null,
  );

  function selectElement(id: string): void {
    selectedId.value = id;
  }

  function relationName(targetId: string): string {
    return items.value.find((item) => item.id === targetId)?.name ?? targetId;
  }

  function openProject(item: StoryElementOverview): void {
    void router.push({
      name: "project-bible",
      params: { projectId: item.projectId },
      query: { element: item.id },
    });
  }

  /**
   * 拉全量设定与作品列表。
   * `keepSelection` 用于从缓存回来时刷新：还停在上次看的那条上，
   * 只有它被删了才退回首条，避免一回来就被跳走。
   */
  async function loadOverview(keepSelection = false): Promise<void> {
    busy.value = true;
    error.value = "";
    try {
      const [all, projectList] = await Promise.all([
        storyElementService.listAll(),
        projectService.list(),
      ]);
      items.value = all;
      projects.value = projectList;
      if (keepSelection && all.some((item) => item.id === selectedId.value)) return;
      selectedId.value = all.length > 0 ? all[0].id : "";
    } catch (err) {
      error.value = `读取全局设定失败：${String(err)}`;
    } finally {
      busy.value = false;
    }
  }

  onMounted(async () => {
    // 兼容旧的 /bible?project=xxx 链接：跳转到唯一的作品设定库页面。
    const legacyProject = route.query.project;
    if (typeof legacyProject === "string") {
      const query = { ...route.query };
      delete query.project;
      try {
        await router.replace({
          name: "project-bible",
          params: { projectId: legacyProject },
          query,
        });
      } catch {
        // 导航被守卫取消时仍把全局页填上内容，避免用户停在空白页。
        await loadOverview();
      }
      return;
    }
    await loadOverview();
  });

  // 设定会在作品内被改动，回到全局页时补一次刷新，免得看到旧汇总。
  onReactivated(() => void loadOverview(true));

  return {
    items,
    projects,
    projectFilter,
    filterKind,
    keyword,
    selectedId,
    error,
    busy,
    kindOptions,
    projectOptions,
    filtered,
    selected,
    selectElement,
    relationName,
    openProject,
    kindLabel: (kind: StoryElementKind) => STORY_KIND_LABEL[kind],
  };
}
