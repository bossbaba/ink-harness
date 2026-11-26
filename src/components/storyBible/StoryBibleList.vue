<script setup lang="ts">
import { NButton, NEmpty, NInput } from "naive-ui";
import SegmentedControl from "@/components/common/SegmentedControl.vue";
import type { KindFilter } from "@/composables/useStoryBible";
import { STORY_KIND_ICON, type StoryElement } from "@/types";

// 设定列表：只负责展示与派发交互。筛选和搜索状态用 v-model 交给父组件，
// 真正的过滤逻辑在 useStoryBible 里，避免这里和页面各存一份导致不同步。
defineProps<{
  filterKind: KindFilter;
  filterOptions: Array<{ label: string; value: KindFilter }>;
  keyword: string;
  elements: StoryElement[];
  filteredElements: StoryElement[];
  selectedId: string;
}>();

const emit = defineEmits<{
  (e: "update:filterKind", value: KindFilter): void;
  (e: "update:keyword", value: string): void;
  (e: "select", id: string): void;
}>();
</script>

<template>
  <aside class="panel panel--list">
    <SegmentedControl
      wrap
      size="small"
      :options="filterOptions"
      :model-value="filterKind"
      @update:model-value="(value: string) => emit('update:filterKind', value as KindFilter)"
    />
    <NInput
      :value="keyword"
      placeholder="搜索名称、别名或摘要"
      size="small"
      clearable
      @update:value="(value: string) => emit('update:keyword', value)"
    />
    <div class="element-list">
      <NButton
        v-for="element in filteredElements"
        :key="element.id"
        text
        block
        class="element-item"
        :class="{ 'element-item--active': element.id === selectedId }"
        @click="emit('select', element.id)"
      >
        <span class="element-item__icon">{{ STORY_KIND_ICON[element.kind] }}</span>
        <span class="element-item__body">
          <span class="element-item__name">{{ element.name }}</span>
          <span class="element-item__summary">{{ element.summary || "暂无摘要" }}</span>
        </span>
        <span v-if="element.detail.relations?.length" class="element-item__count">
          {{ element.detail.relations.length }}
        </span>
      </NButton>
      <NEmpty
        v-if="filteredElements.length === 0"
        class="element-list__empty"
        size="small"
        :show-icon="false"
        :description="
          elements.length === 0 ? '还没有设定条目，点击「新建设定」开始。' : '没有匹配的设定条目。'
        "
      />
    </div>
  </aside>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.panel {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  min-width: 0;
  max-height: calc(100vh - 160px);
  padding: t.$space-4;
  overflow: auto;
  @include m.card-surface(var(--bg-surface));
}

.element-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 120px;

  &__empty {
    padding: t.$space-4;
    text-align: center;
    font-size: 12px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.element-item {
  display: flex;
  align-items: center;
  gap: t.$space-2;
  width: 100%;
  padding: t.$space-2;
  border: none;
  border-radius: t.$radius-sm;
  background: transparent;
  color: var(--text-primary, #{t.$ink});
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
  }

  &--active {
    // 设计稿选中项是更实的浅绿药丸，用 accent-soft-strong 和普通 hover 拉开层级。
    background: var(--accent-soft-strong, var(--accent-soft));
  }

  &__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: t.$radius-sm;
    background: var(--bg-surface);
    color: var(--accent, #{t.$accent});
    font-size: 11px;
  }

  &__body {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  &__name {
    font-size: 12px;
    font-weight: 600;
    @include m.ellipsis;
  }

  &__summary {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
    @include m.ellipsis;
  }

  &__count {
    font-size: 10px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

// NButton text 变体自带 padding/居中，双写类名把设定条目的列表布局覆盖回来。
.element-item.element-item {
  display: flex;
  align-items: center;
  gap: t.$space-2;
  width: 100%;
  padding: t.$space-2;
  border: none;
  border-radius: t.$radius-sm;
  background: transparent;
  color: var(--text-primary, #{t.$ink});
  font-size: inherit;
  text-align: left;
  white-space: normal;

  &:hover {
    background: var(--bg-hover);
  }

  &.element-item--active {
    // 设计稿选中项是更实的浅绿药丸，用 accent-soft-strong 和普通 hover 拉开层级。
    background: var(--accent-soft-strong, var(--accent-soft));
  }

  // 图标、正文与计数在 .n-button__content 这一层横向排列。
  :deep(.n-button__content) {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: t.$space-2;
    width: 100%;
  }
}
</style>
