<script setup lang="ts">
import { NInput } from "naive-ui";
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
    <div class="kind-tabs">
      <button
        v-for="option in filterOptions"
        :key="option.value"
        type="button"
        class="kind-tabs__item"
        :class="{ 'kind-tabs__item--active': filterKind === option.value }"
        @click="emit('update:filterKind', option.value)"
      >
        {{ option.label }}
      </button>
    </div>
    <NInput
      :value="keyword"
      placeholder="搜索名称、别名或摘要"
      size="small"
      clearable
      @update:value="(value: string) => emit('update:keyword', value)"
    />
    <div class="element-list">
      <button
        v-for="element in filteredElements"
        :key="element.id"
        type="button"
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
      </button>
      <p v-if="filteredElements.length === 0" class="element-list__empty">
        {{ elements.length === 0 ? "还没有设定条目，点击「新建设定」开始。" : "没有匹配的设定条目。" }}
      </p>
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

.kind-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: t.$space-1;

  &__item {
    padding: 3px 9px;
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: 999px;
    background: transparent;
    color: var(--text-soft, #{t.$ink-soft});
    font-size: 11px;
    cursor: pointer;

    &--active {
      border-color: var(--accent, #{t.$accent});
      color: var(--accent, #{t.$accent});
    }
  }
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
    background: rgba(128, 128, 128, 0.08);
  }

  &--active {
    background: var(--bg-sunken, #{t.$paper-sunken});
  }

  &__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: t.$radius-sm;
    background: var(--accent-soft, rgba(0, 193, 0, 0.1));
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
</style>
