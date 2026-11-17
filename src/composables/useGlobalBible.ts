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

  onMounted(async () => {
    // 兼容旧的 /bible?project=xxx 链接：跳转到唯一的作品设定库页面。
    const legacyProject = route.query.project;
    if (typeof legacyProject === "string") {
      const query = { ...route.query };
      delete query.project;
      await router.replace({
        name: "project-bible",
        params: { projectId: legacyProject },
        query,
      });
      return;
    }

    busy.value = true;
    error.value = "";
    try {
      const [all, projectList] = await Promise.all([
        storyElementService.listAll(),
        projectService.list(),
      ]);
      items.value = all;
      projects.value = projectList;
      if (all.length > 0) selectElement(all[0].id);
    } catch (err) {
      error.value = `读取全局设定失败：${String(err)}`;
    } finally {
      busy.value = false;
    }
  });

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
