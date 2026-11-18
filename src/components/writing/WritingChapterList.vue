<script setup lang="ts">
import { NButton, NEmpty, NSpin, NTag } from "naive-ui";
import {
  type Act,
  CHAPTER_STATUS_LABEL,
  CHAPTER_STATUS_TAG_TYPE,
  type Chapter,
  OUTLINE_ACTS,
} from "@/types";
import { formatCount } from "@/utils/text";

/**
 * 写作台左侧章节列表：按三幕分组，标题 + 字数 + 状态。
 * 只负责展示与派发选中事件；章节数据由页面/组合式函数提供。
 */
defineProps<{
  groups: Array<{ act: Act; chapters: Chapter[] }>;
  activeChapterId: string;
  loading: boolean;
  totalWords: number;
}>();

const emit = defineEmits<(event: "select", chapterId: string) => void>();

function actLabel(act: Act): string {
  return OUTLINE_ACTS.find((item) => item.value === act)?.label ?? "第?幕";
}
</script>

<template>
  <aside class="chapter-list">
    <div class="chapter-list__head">
      <span class="chapter-list__title">章节</span>
      <span class="chapter-list__total">{{ formatCount(totalWords) }} 字</span>
    </div>

    <div v-if="loading" class="chapter-list__hint">
      <NSpin size="small" />
      <span>正在载入章节…</span>
    </div>
    <NEmpty
      v-else-if="groups.every((group) => group.chapters.length === 0)"
      class="chapter-list__hint"
      size="small"
      :show-icon="false"
      description="还没有章节，先到「大纲」建几章再回来写。"
    />

    <div v-for="group in groups" :key="group.act" class="chapter-list__group">
      <div class="chapter-list__act">
        <span>{{ actLabel(group.act) }}</span>
        <NTag class="chapter-list__count" size="tiny" round :bordered="false">
          {{ group.chapters.length }}
        </NTag>
      </div>
      <NButton
        v-for="(chapter, index) in group.chapters"
        :key="chapter.id"
        text
        block
        class="chapter-list__item"
        :class="{ 'chapter-list__item--active': chapter.id === activeChapterId }"
        @click="emit('select', chapter.id)"
      >
        <span class="chapter-list__name">
          <span class="chapter-list__order">{{ index + 1 }}</span>
          <span class="chapter-list__text">{{ chapter.title }}</span>
        </span>
        <span class="chapter-list__meta">
          <NTag size="small" :bordered="false" :type="CHAPTER_STATUS_TAG_TYPE[chapter.status]">
            {{ CHAPTER_STATUS_LABEL[chapter.status] }}
          </NTag>
          <span class="chapter-list__words">{{ formatCount(chapter.wordCount) }}</span>
        </span>
      </NButton>
    </div>
  </aside>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.chapter-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  padding: t.$space-4;
  overflow: auto;
  border-right: 1px solid var(--divider, #{t.$divider});
  background: var(--bg-surface);
  @include m.thin-scrollbar;

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: t.$space-2;
    margin-bottom: t.$space-3;
  }

  &__title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  &__total,
  &__hint {
    font-size: 11px;
    color: var(--text-faint);
  }

  &__hint {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    margin: 0 0 t.$space-3;
    line-height: 1.6;
  }

  &__group + &__group {
    margin-top: t.$space-4;
  }

  &__act {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: t.$space-2;
    font-size: 11px;
    color: var(--text-faint);
  }

  // NTag 自带圆角与配色，这里只保证单个数字时的最小宽度。
  &__count {
    min-width: 20px;
    justify-content: center;
  }

  &__item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: t.$space-2 t.$space-3;
    border: 1px solid transparent;
    border-radius: t.$radius-md;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background t.$duration t.$ease;

    &:hover {
      background: var(--bg-sunken);
    }

    &--active {
      border-color: var(--accent, #{t.$accent});
      background: var(--bg-sunken);
    }
  }

  // NButton text 变体的默认 padding/字号会覆盖列表项布局，双写类名覆盖回来。
  &__item.chapter-list__item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: t.$space-2 t.$space-3;
    border: 1px solid transparent;
    border-radius: t.$radius-md;
    background: transparent;
    font-size: inherit;
    text-align: left;
    white-space: normal;

    &:hover {
      background: var(--bg-sunken);
    }

    &.chapter-list__item--active {
      border-color: var(--accent, #{t.$accent});
      background: var(--bg-sunken);
    }

    // 章名与字数副标题在 .n-button__content 这一层纵向排列。
    :deep(.n-button__content) {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 4px;
      width: 100%;
      white-space: normal;
    }
  }

  &__name {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
  }

  &__order {
    flex: none;
    width: 16px;
    font-size: 11px;
    color: var(--text-faint);
  }

  &__text {
    font-size: 12px;
    color: var(--text-primary);
    @include m.ellipsis;
  }

  &__meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
    padding-left: 24px;
  }

  &__words {
    font-size: 11px;
    color: var(--text-faint);
  }
}
</style>
