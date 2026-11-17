import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { projectService } from "@/services/projectService";
import { storyElementService } from "@/services/storyElementService";
import {
  type ConsistencyIssue,
  STORY_KIND_LABEL,
  STORY_KIND_OPTIONS,
  type StoryElement,
  type StoryElementDetail,
  type StoryElementKind,
  type StoryRelation,
} from "@/types";

export type KindFilter = StoryElementKind | "all";

/** 表单草稿：把 detail JSON 摊平成可编辑字段。 */
export interface Draft {
  id: string;
  kind: StoryElementKind;
  name: string;
  summary: string;
  aliasesText: string;
  timeStart: string;
  timeEnd: string;
  notes: string;
  relations: StoryRelation[];
}

/** 作品内设定库：projectId 来自路由参数，禁止缺省或回退到全局数据。 */
export function useStoryBible(projectIdFromRoute: string) {
  const route = useRoute();

  const projectId = ref(projectIdFromRoute);
  const projectTitle = ref("");
  const elements = ref<StoryElement[]>([]);
  const filterKind = ref<KindFilter>("all");
  const keyword = ref("");
  const selectedId = ref("");
  const createShow = ref(false);
  const createKind = ref<StoryElementKind>("character");
  const createName = ref("");
  const createSummary = ref("");
  const issues = ref<ConsistencyIssue[]>([]);
  const error = ref("");
  const busy = ref(false);

  function emptyDraft(): Draft {
    return {
      id: "",
      kind: "character",
      name: "",
      summary: "",
      aliasesText: "",
      timeStart: "",
      timeEnd: "",
      notes: "",
      relations: [],
    };
  }

  const draft = ref<Draft>(emptyDraft());

  const filterOptions = computed(() => [
    { label: "全部", value: "all" as const },
    ...STORY_KIND_OPTIONS.map((option) => ({
      label: option.label,
      value: option.value as KindFilter,
    })),
  ]);

  const filteredElements = computed(() => {
    const term = keyword.value.trim().toLowerCase();
    return elements.value.filter((element) => {
      if (filterKind.value !== "all" && element.kind !== filterKind.value) return false;
      if (!term) return true;
      const aliases = element.detail.aliases ?? [];
      return [element.name, element.summary, ...aliases].join(" ").toLowerCase().includes(term);
    });
  });

  const selected = computed<StoryElement | null>(
    () => elements.value.find((element) => element.id === selectedId.value) ?? null,
  );

  const targetOptions = computed(() =>
    elements.value
      .filter((element) => element.id !== selectedId.value)
      .map((element) => ({
        label: `${STORY_KIND_LABEL[element.kind]} · ${element.name}`,
        value: element.id,
      })),
  );

  function toDraft(element: StoryElement): Draft {
    return {
      id: element.id,
      kind: element.kind,
      name: element.name,
      summary: element.summary,
      aliasesText: (element.detail.aliases ?? []).join("，"),
      timeStart: element.detail.timeStart ?? "",
      timeEnd: element.detail.timeEnd ?? "",
      notes: element.detail.notes ?? "",
      relations: (element.detail.relations ?? []).map((relation) => ({ ...relation })),
    };
  }

  function selectElement(id: string): void {
    const element = elements.value.find((item) => item.id === id);
    if (!element) return;
    selectedId.value = id;
    draft.value = toDraft(element);
    error.value = "";
  }

  function startNew(): void {
    createShow.value = true;
    createKind.value = filterKind.value === "all" ? "character" : filterKind.value;
    createName.value = "";
    createSummary.value = "";
    error.value = "";
  }

  async function loadElements(): Promise<void> {
    issues.value = [];
    if (!projectId.value) {
      elements.value = [];
      return;
    }
    try {
      elements.value = await storyElementService.list(projectId.value);
      if (selectedId.value && elements.value.some((item) => item.id === selectedId.value)) {
        selectElement(selectedId.value);
      } else if (elements.value.length > 0) {
        selectElement(elements.value[0].id);
      } else {
        draft.value = emptyDraft();
      }
    } catch (err) {
      error.value = `读取设定失败：${String(err)}`;
    }
  }

  function buildDetail(): StoryElementDetail {
    const aliases = draft.value.aliasesText
      .split(/[,，、]/)
      .map((alias) => alias.trim())
      .filter(Boolean);
    const detail: StoryElementDetail = {
      ...(selected.value?.detail ?? {}),
      aliases,
      notes: draft.value.notes,
      relations: draft.value.relations,
    };
    if (draft.value.kind === "event") {
      detail.timeStart = draft.value.timeStart;
      detail.timeEnd = draft.value.timeEnd;
    } else {
      delete detail.timeStart;
      delete detail.timeEnd;
    }
    return detail;
  }

  async function save(): Promise<void> {
    if (!draft.value.name.trim()) {
      error.value = "请输入设定名称";
      return;
    }
    if (!projectId.value) {
      error.value = "请先选择作品";
      return;
    }
    if (!selected.value) return;
    busy.value = true;
    error.value = "";
    try {
      const detail = buildDetail();
      await storyElementService.update({
        ...selected.value,
        kind: draft.value.kind,
        name: draft.value.name,
        summary: draft.value.summary,
        detail,
      });
      await loadElements();
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  async function submitCreate(): Promise<void> {
    if (!createName.value.trim()) {
      error.value = "请输入设定名称";
      return;
    }
    if (!projectId.value) return;
    busy.value = true;
    error.value = "";
    try {
      const created = await storyElementService.create({
        projectId: projectId.value,
        kind: createKind.value,
        name: createName.value,
        summary: createSummary.value,
        detail: {},
      });
      createShow.value = false;
      createName.value = "";
      createSummary.value = "";
      await loadElements();
      selectElement(created.id);
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  async function removeSelected(): Promise<void> {
    if (!selected.value) return;
    busy.value = true;
    try {
      await storyElementService.remove(selected.value.id);
      selectedId.value = "";
      await loadElements();
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  function addRelation(relation: StoryRelation): void {
    if (draft.value.relations.some((item) => item.targetId === relation.targetId)) return;
    draft.value.relations.push(relation);
  }

  function removeRelation(index: number): void {
    draft.value.relations.splice(index, 1);
  }

  function relationTargetName(id: string): string {
    return elements.value.find((element) => element.id === id)?.name ?? id;
  }

  async function checkConsistency(): Promise<void> {
    if (!projectId.value) return;
    busy.value = true;
    error.value = "";
    try {
      issues.value = await storyElementService.checkConsistency(projectId.value);
    } catch (err) {
      error.value = String(err);
    } finally {
      busy.value = false;
    }
  }

  function focusIssue(issue: ConsistencyIssue): void {
    const target = issue.elementIds.find((id) => elements.value.some((item) => item.id === id));
    if (!target) return;
    filterKind.value = "all";
    keyword.value = "";
    selectElement(target);
  }

  onMounted(async () => {
    if (!projectIdFromRoute) {
      error.value = "缺少作品 ID，无法打开作品设定库。";
      return;
    }
    try {
      const project = await projectService.get(projectIdFromRoute);
      if (!project) {
        error.value = "作品不存在或已删除。";
        return;
      }
      projectTitle.value = project.title;
      await loadElements();
      const queryElement = route.query.element;
      if (
        typeof queryElement === "string" &&
        elements.value.some((item) => item.id === queryElement)
      ) {
        selectElement(queryElement);
      }
    } catch (err) {
      error.value = `读取作品失败：${String(err)}`;
    }
  });

  return {
    projectId,
    projectTitle,
    elements,
    filterKind,
    keyword,
    selectedId,
    createShow,
    createKind,
    createName,
    createSummary,
    issues,
    error,
    busy,
    draft,
    filterOptions,
    filteredElements,
    selected,
    targetOptions,
    selectElement,
    startNew,
    submitCreate,
    save,
    removeSelected,
    addRelation,
    removeRelation,
    relationTargetName,
    checkConsistency,
    focusIssue,
  };
}
