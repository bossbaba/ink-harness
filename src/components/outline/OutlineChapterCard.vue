<script setup lang="ts">
import { NButton, NPopconfirm, NTag } from "naive-ui";
import { CHAPTER_STATUS_LABEL, CHAPTER_STATUS_TAG_TYPE, type Chapter, type Scene } from "@/types";
import { formatCount } from "@/utils/text";
import OutlineSceneCard from "./OutlineSceneCard.vue";

// 章节卡：既是拖拽源（章节可跨幕移动），也是场景拖拽的落点。
const props = defineProps<{
  chapter: Chapter;
  scenes: Scene[];
  /** 本章关联的伏笔标记。 */
  tags: string[];
  active: boolean;
}>();

const emit = defineEmits<{
  (e: "select", chapter: Chapter): void;
  (e: "edit", chapter: Chapter): void;
  (e: "remove", chapter: Chapter): void;
  (e: "add-scene", chapter: Chapter): void;
  (e: "edit-scene", scene: Scene): void;
  (e: "remove-scene", scene: Scene): void;
  (e: "dragstart", chapter: Chapter): void;
  (e: "dragstart-scene", scene: Scene): void;
  (e: "dragend"): void;
  (e: "drop-chapter", chapter: Chapter): void;
  (e: "drop-scene", chapter: Chapter, index: number): void;
}>();

// 场景被拖到某张场景卡上时插到它前面；拖到列表空白处则追加到末尾。
function onSceneDrop(target: Scene): void {
  const index = props.scenes.findIndex((scene) => scene.id === target.id);
  emit("drop-scene", props.chapter, Math.max(index, 0));
}
</script>

<template>
  <article
    class="chapter"
    :class="{ 'chapter--active': active }"
    draggable="true"
    @dragstart.stop="emit('dragstart', chapter)"
    @dragend="emit('dragend')"
    @dragover.stop.prevent
    @drop.stop.prevent="emit('drop-chapter', chapter)"
  >
    <header class="chapter__head" @click="emit('select', chapter)">
      <span class="chapter__order">{{ chapter.sortOrder + 1 }}</span>
      <span class="chapter__title">{{ chapter.title }}</span>
      <span v-if="chapter.wordCount" class="chapter__words"
        >{{ formatCount(chapter.wordCount) }} 字</span
      >
      <NTag size="tiny" :bordered="false" :type="CHAPTER_STATUS_TAG_TYPE[chapter.status]">
        {{ CHAPTER_STATUS_LABEL[chapter.status] }}
      </NTag>
    </header>

    <p v-if="chapter.summary" class="chapter__summary">{{ chapter.summary }}</p>

    <div v-if="tags.length" class="chapter__tags">
      <NTag v-for="tag in tags" :key="tag" size="tiny" :bordered="false" type="warning">
        {{ tag }}
      </NTag>
    </div>

    <div
      class="chapter__scenes"
      @dragover.stop.prevent
      @drop.stop.prevent="emit('drop-scene', chapter, scenes.length)"
    >
      <OutlineSceneCard
        v-for="scene in scenes"
        :key="scene.id"
        :scene="scene"
        :tags="tags"
        @edit="emit('edit-scene', $event)"
        @remove="emit('remove-scene', $event)"
        @dragstart="emit('dragstart-scene', $event)"
        @dragend="emit('dragend')"
        @drop="onSceneDrop"
      />
      <p v-if="!scenes.length" class="chapter__empty">暂无场景，拖入或点击「+ 场景」添加。</p>
    </div>

    <footer class="chapter__footer">
      <NButton size="tiny" quaternary @click.stop="emit('add-scene', chapter)">+ 场景</NButton>
      <span class="chapter__spacer" />
      <div class="chapter__actions">
        <NButton size="tiny" quaternary @click.stop="emit('edit', chapter)">编辑</NButton>
        <NPopconfirm @positive-click="emit('remove', chapter)">
          <template #trigger>
            <NButton size="tiny" quaternary type="error" @click.stop>删除</NButton>
          </template>
          删除该章节及其下所有场景？
        </NPopconfirm>
      </div>
    </footer>
  </article>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.chapter {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  padding: t.$space-3;
  border: 1px solid var(--divider, #{t.$divider});
  border-radius: t.$radius-md;
  background: var(--bg-surface);
  cursor: grab;
  transition: border-color t.$duration t.$ease, box-shadow t.$duration t.$ease;

  &:active {
    cursor: grabbing;
  }

  &--active {
    border-color: var(--accent, #{t.$accent});
    box-shadow: 0 0 0 1px var(--accent, #{t.$accent});
  }

  &__head {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
    cursor: pointer;
  }

  &__order {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--bg-sunken);
    font-size: 10px;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__title {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
    @include m.ellipsis;
  }

  &__words {
    flex: none;
    font-size: 10px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__summary {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-soft, #{t.$ink-soft});
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }

  &__scenes {
    display: flex;
    flex-direction: column;
    gap: t.$space-1;
    min-height: 34px;
    padding: t.$space-1;
    border: 1px dashed var(--divider, #{t.$divider});
    border-radius: t.$radius-sm;
  }

  &__empty {
    margin: 0;
    padding: t.$space-2;
    font-size: 10px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__footer {
    display: flex;
    align-items: center;
    gap: t.$space-1;
  }

  &__spacer {
    flex: 1;
  }

  &__actions {
    display: flex;
    gap: t.$space-1;
    opacity: 0;
    transition: opacity t.$duration t.$ease;
  }

  &:hover &__actions,
  &:focus-within &__actions {
    opacity: 1;
  }
}
</style>
