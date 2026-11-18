<script setup lang="ts">
import { NButton, NInput, NPopover, NSpin } from "naive-ui";
import { computed, ref } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import { outlineService } from "@/services/outlineService";
import { storyElementService } from "@/services/storyElementService";
import { type CopilotReference, STORY_KIND_LABEL, type StoryElement } from "@/types";

/**
 * Copilot 的「@引用」选择器：从本作品的设定条目与已有章节里挑资料。
 *
 * 数据在第一次展开时才拉取（设定全量 + 大纲快照），
 * 同一作品内多次展开直接复用，避免每开一次面板就重查一遍库。
 */
const props = defineProps<{
  projectId: string;
  /** 已经引用的资料，用于在列表里打勾。 */
  selected: CopilotReference[];
}>();

// 点选一条资料；加还是删由上层按当前选中状态决定。
const emit = defineEmits<(event: "pick", reference: CopilotReference) => void>();

interface PickerRow {
  reference: CopilotReference;
  title: string;
  subtitle: string;
  checked: boolean;
}

const show = ref(false);
const loading = ref(false);
const error = ref("");
const keyword = ref("");
const elements = ref<StoryElement[]>([]);
const chapters = ref<Array<{ id: string; act: number; title: string }>>([]);
// 记住已加载的作品，切作品后重新取数；同作品反复展开不重复请求。
let loadedFor = "";

async function load(): Promise<void> {
  if (!props.projectId || loadedFor === props.projectId) return;
  loading.value = true;
  error.value = "";
  try {
    const [elementList, snapshot] = await Promise.all([
      storyElementService.list(props.projectId),
      outlineService.snapshot(props.projectId),
    ]);
    elements.value = elementList;
    chapters.value = snapshot.chapters.map((chapter) => ({
      id: chapter.id,
      act: chapter.act,
      title: chapter.title,
    }));
    loadedFor = props.projectId;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function handleShow(value: boolean): void {
  show.value = value;
  if (value) void load();
}

const term = computed(() => keyword.value.trim().toLowerCase());

function match(text: string): boolean {
  return !term.value || text.toLowerCase().includes(term.value);
}

function isChecked(reference: CopilotReference): boolean {
  return props.selected.some((item) => item.kind === reference.kind && item.id === reference.id);
}

const elementRows = computed<PickerRow[]>(() =>
  elements.value
    .filter((element) => match(element.name))
    .map((element) => {
      const reference: CopilotReference = { kind: "element", id: element.id, label: element.name };
      return {
        reference,
        title: element.name,
        subtitle: `${STORY_KIND_LABEL[element.kind]}${element.summary ? ` · ${element.summary}` : ""}`,
        checked: isChecked(reference),
      };
    }),
);

const chapterRows = computed<PickerRow[]>(() =>
  chapters.value
    .filter((chapter) => match(chapter.title))
    .map((chapter) => {
      const label = `第${chapter.act}幕 · ${chapter.title}`;
      const reference: CopilotReference = { kind: "chapter", id: chapter.id, label };
      return {
        reference,
        title: chapter.title,
        subtitle: `第${chapter.act}幕正文`,
        checked: isChecked(reference),
      };
    }),
);

const isEmpty = computed(
  () =>
    !loading.value &&
    !error.value &&
    elementRows.value.length === 0 &&
    chapterRows.value.length === 0,
);
</script>

<template>
  <NPopover
    :show="show"
    trigger="click"
    placement="top-start"
    :width="320"
    @update:show="handleShow"
  >
    <template #trigger>
      <NButton size="small">＠ 引用</NButton>
    </template>

    <div class="picker">
      <NInput v-model:value="keyword" size="small" clearable placeholder="搜索设定名或章节名" />

      <div v-if="loading" class="picker__state">
        <NSpin size="small" />
        <span>正在载入本作品的设定与章节…</span>
      </div>
      <p v-else-if="error" class="picker__state picker__state--error">{{ error }}</p>
      <p v-else-if="isEmpty" class="picker__state">没有匹配的设定或章节。</p>

      <div v-else class="picker__list">
        <template v-if="elementRows.length">
          <div class="picker__group">设定</div>
          <NButton
            v-for="row in elementRows"
            :key="`element-${row.reference.id}`"
            text
            block
            class="picker__row"
            :class="{ 'picker__row--checked': row.checked }"
            @click="emit('pick', row.reference)"
          >
            <span class="picker__check">
              <AppIcon v-if="row.checked" name="check" :size="13" />
            </span>
            <span class="picker__body">
              <span class="picker__title">{{ row.title }}</span>
              <span class="picker__subtitle">{{ row.subtitle }}</span>
            </span>
          </NButton>
        </template>

        <template v-if="chapterRows.length">
          <div class="picker__group">章节</div>
          <NButton
            v-for="row in chapterRows"
            :key="`chapter-${row.reference.id}`"
            text
            block
            class="picker__row"
            :class="{ 'picker__row--checked': row.checked }"
            @click="emit('pick', row.reference)"
          >
            <span class="picker__check">
              <AppIcon v-if="row.checked" name="check" :size="13" />
            </span>
            <span class="picker__body">
              <span class="picker__title">{{ row.title }}</span>
              <span class="picker__subtitle">{{ row.subtitle }}</span>
            </span>
          </NButton>
        </template>
      </div>
    </div>
  </NPopover>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.picker {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  min-width: 0;

  &__state {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    margin: 0;
    padding: t.$space-3 0;
    font-size: 12px;
    color: var(--text-faint, #{t.$ink-faint});

    &--error {
      color: var(--error, #{t.$error});
    }
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 300px;
    overflow: auto;
    @include m.thin-scrollbar;
  }

  &__group {
    padding: t.$space-2 0 t.$space-1;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__row {
    display: flex;
    align-items: flex-start;
    gap: t.$space-2;
    width: 100%;
    padding: t.$space-2;
    border: none;
    border-radius: t.$radius-md;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background t.$duration t.$ease;

    &:hover {
      background: var(--bg-sunken);
    }

    &--checked {
      background: var(--bg-sunken);
    }
  }

  // NButton text 变体自带 padding 与居中样式，双写类名把列表行布局覆盖回来。
  &__row.picker__row {
    display: flex;
    align-items: flex-start;
    gap: t.$space-2;
    width: 100%;
    padding: t.$space-2;
    border: none;
    border-radius: t.$radius-md;
    background: transparent;
    font-size: inherit;
    text-align: left;
    white-space: normal;

    &:hover,
    &.picker__row--checked {
      background: var(--bg-sunken);
    }

    // 勾选框与正文在 .n-button__content 这一层横向排列。
    :deep(.n-button__content) {
      display: flex;
      align-items: flex-start;
      justify-content: flex-start;
      gap: t.$space-2;
      width: 100%;
      white-space: normal;
    }
  }

  &__check {
    width: 14px;
    flex-shrink: 0;
    font-size: 12px;
    color: var(--accent, #{t.$accent});
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__title {
    font-size: 12px;
    color: var(--text-primary);
    @include m.ellipsis;
  }

  &__subtitle {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
    @include m.ellipsis;
  }
}
</style>
