<script setup lang="ts">
import { NButton, NInput, NPopover } from "naive-ui";
import { computed, ref } from "vue";
import AppIcon from "@/components/common/AppIcon.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import { type CopilotReference, STORY_KIND_LABEL, type StoryElement } from "@/types";

/**
 * Copilot 的「@引用」选择器：从本作品的设定条目与已有章节里挑资料。
 *
 * 这是纯展示组件：候选数据、加载状态由 useWritingCopilot 提供并经父级传入，
 * 本组件只做本地搜索过滤与点选上报，不直接调用任何 service。
 */
const props = defineProps<{
  /** 已经引用的资料，用于在列表里打勾。 */
  selected: CopilotReference[];
  /** 候选设定条目。 */
  elements: StoryElement[];
  /** 候选章节。 */
  chapters: Array<{ id: string; act: number; title: string }>;
  /** 候选是否正在加载。 */
  loading: boolean;
  /** 加载失败的错误文案，空串表示无错误。 */
  error: string;
}>();

// pick：点选一条资料，加还是删由上层按当前选中状态决定。
// open：面板首次展开时通知上层加载候选（是否重复请求由 composable 去重）。
const emit = defineEmits<{
  (event: "pick", reference: CopilotReference): void;
  (event: "open"): void;
}>();

/**
 * 展开状态由父级用 `v-model:model-open` 接管（输入框打 `@` 时置 true）。
 * 用 defineModel 而不是手写 prop + emit：手写时容易把事件发成 `update:model-open`，
 * 而 `v-model:model-open` 监听的是 `update:modelOpen`，两者对不上就会表现为「点了没反应」。
 */
const modelOpen = defineModel<boolean>("modelOpen", { default: false });

interface PickerRow {
  reference: CopilotReference;
  title: string;
  subtitle: string;
  checked: boolean;
}

const show = computed(() => modelOpen.value);
const keyword = ref("");

function handleShow(value: boolean): void {
  modelOpen.value = value;
  if (value) emit("open");
}

const term = computed(() => keyword.value.trim().toLowerCase());

function match(text: string): boolean {
  return !term.value || text.toLowerCase().includes(term.value);
}

function isChecked(reference: CopilotReference): boolean {
  return props.selected.some((item) => item.kind === reference.kind && item.id === reference.id);
}

const elementRows = computed<PickerRow[]>(() =>
  props.elements
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
  props.chapters
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
    !props.loading &&
    !props.error &&
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

      <LoadingState
        v-if="props.loading"
        class="picker__state"
        variant="inline"
        text="正在载入本作品的设定与章节…"
      />
      <p v-else-if="props.error" class="picker__state picker__state--error">{{ props.error }}</p>
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
