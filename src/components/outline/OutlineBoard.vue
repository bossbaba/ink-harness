<script setup lang="ts">
import { NButton, NEmpty, NTag } from "naive-ui";
import { computed, ref } from "vue";
import { type Act, type Chapter, OUTLINE_ACTS, type Scene } from "@/types";
import OutlineChapterCard from "./OutlineChapterCard.vue";

// 三幕看板：负责拖拽落点判定，把「移动意图」交给页面处理，自身不改数据。
const props = defineProps<{
  chapters: Chapter[];
  scenesByChapter: Record<string, Scene[]>;
  foreshadowTags: Record<string, string[]>;
  activeChapterId: string;
}>();

const emit = defineEmits<{
  (e: "move-chapter", chapterId: string, act: Act, index: number): void;
  (
    e: "move-scene",
    sceneId: string,
    fromChapterId: string,
    toChapterId: string,
    index: number,
  ): void;
  (e: "add-chapter", act: Act): void;
  (e: "select-chapter", id: string): void;
  (e: "edit-chapter", chapter: Chapter): void;
  (e: "remove-chapter", chapter: Chapter): void;
  (e: "add-scene", chapter: Chapter): void;
  (e: "edit-scene", scene: Scene): void;
  (e: "remove-scene", scene: Scene): void;
}>();

// 拖拽状态只在本组件内维护，用来区分当前拖的是章节还是场景。
const draggingChapterId = ref("");
const draggingScene = ref<{ id: string; chapterId: string } | null>(null);

function chaptersOfAct(act: Act): Chapter[] {
  return props.chapters
    .filter((chapter) => chapter.act === act)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

const chaptersByAct = computed<Record<Act, Chapter[]>>(() => ({
  1: chaptersOfAct(1),
  2: chaptersOfAct(2),
  3: chaptersOfAct(3),
}));

function startChapterDrag(chapter: Chapter): void {
  draggingScene.value = null;
  draggingChapterId.value = chapter.id;
}

function startSceneDrag(scene: Scene): void {
  draggingChapterId.value = "";
  draggingScene.value = { id: scene.id, chapterId: scene.chapterId };
}

function endDrag(): void {
  draggingChapterId.value = "";
  draggingScene.value = null;
}

/** 落到某一幕的空白处：章节追加到该幕末尾。 */
function dropOnAct(act: Act): void {
  if (!draggingChapterId.value) return;
  emit("move-chapter", draggingChapterId.value, act, chaptersByAct.value[act].length);
  endDrag();
}

/**
 * 落到某张章节卡上：
 * - 拖的是章节 → 插到目标章节前面；
 * - 拖的是场景 → 追加到目标章节末尾。
 */
function dropOnChapter(target: Chapter): void {
  if (draggingChapterId.value) {
    if (draggingChapterId.value !== target.id) {
      const index = chaptersByAct.value[target.act].findIndex(
        (chapter) => chapter.id === target.id,
      );
      emit("move-chapter", draggingChapterId.value, target.act, Math.max(index, 0));
    }
  } else if (draggingScene.value) {
    const targetScenes = props.scenesByChapter[target.id] ?? [];
    emit(
      "move-scene",
      draggingScene.value.id,
      draggingScene.value.chapterId,
      target.id,
      targetScenes.length,
    );
  }
  endDrag();
}

/** 落到某张场景卡/场景列表上：插到目标下标。 */
function dropOnScene(chapter: Chapter, index: number): void {
  // 章节被拖到场景区域时，语义仍是「插到这个章节前面」，复用章节落点逻辑。
  if (draggingChapterId.value) {
    dropOnChapter(chapter);
    return;
  }
  if (!draggingScene.value) {
    endDrag();
    return;
  }
  emit("move-scene", draggingScene.value.id, draggingScene.value.chapterId, chapter.id, index);
  endDrag();
}
</script>

<template>
  <div class="board">
    <div class="board__acts">
      <section
        v-for="act in OUTLINE_ACTS"
        :key="act.value"
        class="act"
        @dragover.prevent
        @drop.prevent="dropOnAct(act.value)"
      >
        <header class="act__head">
          <div class="act__label">
            <h3 class="act__title serif">{{ act.label }}</h3>
            <p class="act__hint">{{ act.hint }}</p>
          </div>
          <NTag class="act__count" size="tiny" round :bordered="false">
            {{ chaptersByAct[act.value].length }}
          </NTag>
        </header>

        <div class="act__body">
          <OutlineChapterCard
            v-for="chapter in chaptersByAct[act.value]"
            :key="chapter.id"
            :chapter="chapter"
            :scenes="scenesByChapter[chapter.id] ?? []"
            :tags="foreshadowTags[chapter.id] ?? []"
            :active="chapter.id === activeChapterId"
            @select="emit('select-chapter', $event.id)"
            @edit="emit('edit-chapter', $event)"
            @remove="emit('remove-chapter', $event)"
            @add-scene="emit('add-scene', $event)"
            @edit-scene="emit('edit-scene', $event)"
            @remove-scene="emit('remove-scene', $event)"
            @dragstart="startChapterDrag"
            @dragstart-scene="startSceneDrag"
            @dragend="endDrag"
            @drop-chapter="dropOnChapter"
            @drop-scene="dropOnScene"
          />

          <NButton
            dashed
            block
            size="small"
            class="act__add"
            @click="emit('add-chapter', act.value)"
          >
            + 新增章节
          </NButton>

          <NEmpty
            v-if="chaptersByAct[act.value].length === 0"
            class="act__empty"
            size="tiny"
            :show-icon="false"
            description="这一幕还没有章节，点击上方按钮创建，或把其他幕的章节拖进来。"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.board {
  min-width: 0;
  container-type: inline-size;
}

.board__acts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: t.$space-3;
  align-items: start;
  min-width: 0;

  @container (max-width: 900px) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.act {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  min-width: 0;
  min-height: 160px;
  padding: t.$space-3;
  @include m.card-surface(var(--bg-surface));

  &__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-2;
    padding-bottom: t.$space-2;
    border-bottom: 1px solid var(--divider, #{t.$divider});
  }

  &__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__hint {
    margin: 2px 0 0;
    font-size: 10px;
    color: var(--text-faint, #{t.$ink-faint});
    @include m.ellipsis;
  }

  // NTag 自带圆角与配色，这里只保证单个数字时的最小宽度。
  &__count {
    min-width: 22px;
    justify-content: center;
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    min-width: 0;
  }

  // NButton dashed 变体自带高度/圆角，双写类名保留新增章节按钮的虚线卡片外观。
  &__add.act__add {
    height: auto;
    padding: t.$space-2;
    border: 1px dashed var(--divider, #{t.$divider});
    border-radius: t.$radius-sm;
    background: transparent;
    color: var(--text-soft, #{t.$ink-soft});
    font-size: 11px;
    transition: border-color t.$duration t.$ease, color t.$duration t.$ease;

    &:hover {
      border-color: var(--accent, #{t.$accent});
      color: var(--accent, #{t.$accent});
    }
  }

  &__empty {
    margin: 0;
    padding: t.$space-2;
    font-size: 10px;
    line-height: 1.6;
    color: var(--text-faint, #{t.$ink-faint});
  }
}
</style>
