<script setup lang="ts">
import { NButton, NPopconfirm, NTag } from "naive-ui";
import { computed } from "vue";
import type { Scene } from "@/types";

// 场景卡只展示与派发交互；拖拽的落点判定由父级章节卡完成。
const props = defineProps<{
  scene: Scene;
  /** 该场景所在章节关联的伏笔标记（铺设/回收）。 */
  tags: string[];
  /** 大纲写操作进行中：编辑/删除入口禁用。 */
  busy: boolean;
  /** 正在删除的章节/场景 id，对应行的删除按钮转圈。 */
  removingId: string;
}>();

const emit = defineEmits<{
  (e: "edit", scene: Scene): void;
  (e: "remove", scene: Scene): void;
  (e: "dragstart", scene: Scene): void;
  (e: "dragend"): void;
  (e: "drop", scene: Scene): void;
}>();

// POV/时间/地点是可选项，为空时不占位，避免卡片出现「 · · 」这种空标点。
const meta = computed(() =>
  [
    props.scene.pov ? `POV：${props.scene.pov}` : "",
    props.scene.timeMark ? `时间：${props.scene.timeMark}` : "",
    props.scene.location ? `地点：${props.scene.location}` : "",
  ]
    .filter(Boolean)
    .join(" · "),
);
</script>

<template>
  <div
    class="scene"
    draggable="true"
    @dragstart.stop="emit('dragstart', scene)"
    @dragend="emit('dragend')"
    @dragover.stop.prevent
    @drop.stop.prevent="emit('drop', scene)"
  >
    <div class="scene__head">
      <span class="scene__title">{{ scene.title }}</span>
      <NTag
        v-for="tag in tags"
        :key="tag"
        size="tiny"
        :bordered="false"
        type="warning"
        class="scene__tag"
      >
        {{ tag }}
      </NTag>
    </div>
    <p v-if="meta" class="scene__meta">{{ meta }}</p>
    <p v-if="scene.summary" class="scene__summary">{{ scene.summary }}</p>
    <div class="scene__actions">
      <NButton size="tiny" quaternary :disabled="props.busy" @click.stop="emit('edit', scene)">
        编辑
      </NButton>
      <NPopconfirm @positive-click="emit('remove', scene)">
        <template #trigger>
          <NButton
            size="tiny"
            quaternary
            type="error"
            :loading="props.removingId === props.scene.id"
            :disabled="props.busy && props.removingId !== props.scene.id"
            @click.stop
          >
            删除
          </NButton>
        </template>
        删除这个场景？
      </NPopconfirm>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.scene {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: t.$space-2 t.$space-3;
  border-left: 2px solid var(--accent, #{t.$accent});
  border-radius: t.$radius-sm;
  background: var(--bg-app);
  cursor: grab;

  &:active {
    cursor: grabbing;
  }

  &__head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: t.$space-1;
    min-width: 0;
  }

  &__title {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
    @include m.ellipsis;
  }

  &__tag {
    max-width: 140px;
    @include m.ellipsis;
  }

  &__meta {
    margin: 0;
    font-size: 10px;
    color: var(--text-faint, #{t.$ink-faint});
    @include m.ellipsis;
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
