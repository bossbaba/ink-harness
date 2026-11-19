<script setup lang="ts">
import { NButton, NEmpty, NTag } from "naive-ui";
import { computed, nextTick, ref, watch } from "vue";
import {
  ACT_HINTS,
  type Act,
  actLabel,
  type Chapter,
  DEFAULT_ACT_COUNT,
  type Scene,
} from "@/types";
import OutlineChapterCard from "./OutlineChapterCard.vue";
import OutlineToc from "./OutlineToc.vue";
import { actAnchorId, chapterAnchorId } from "./outlineAnchors";

// 幕次看板：幕数由页面传入（可新增），这里只负责展示与拖拽落点判定，自身不改数据。
const props = defineProps<{
  chapters: Chapter[];
  scenesByChapter: Record<string, Scene[]>;
  foreshadowTags: Record<string, string[]>;
  activeChapterId: string;
  /** 要渲染的幕数：默认三幕，作者可继续往后新增。 */
  actCount: number;
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
  (e: "add-act"): void;
  (e: "remove-act", act: Act): void;
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

/** 1..actCount 的幕列表；新增的幕没有固定语义，所以 hint 允许为空。 */
const acts = computed(() =>
  Array.from({ length: Math.max(1, props.actCount) }, (_, index) => {
    const value = index + 1;
    return { value, label: actLabel(value), hint: ACT_HINTS[value] ?? "" };
  }),
);

function chaptersOfAct(act: Act): Chapter[] {
  return props.chapters
    .filter((chapter) => chapter.act === act)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

const chaptersByAct = computed<Record<number, Chapter[]>>(() => {
  const map: Record<number, Chapter[]> = {};
  for (const act of acts.value) map[act.value] = chaptersOfAct(act.value);
  return map;
});

const boardRef = ref<HTMLElement | null>(null);

/**
 * 选中的章节可能落在滚动可视区之外（例如刚新建、或从写作台带 id 返回），
 * 这里把它带进视野。`block: nearest` 保证已可见时不做多余滚动。
 */
watch(
  () => props.activeChapterId,
  async (chapterId) => {
    if (!chapterId) return;
    await nextTick();
    boardRef.value
      ?.querySelector<HTMLElement>(`#${chapterAnchorId(chapterId)}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  },
  { immediate: true },
);

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
  <div ref="boardRef" class="board">
    <!-- 目录常驻左侧，长页面里靠它直接跳到某一幕或某一章。 -->
    <OutlineToc
      class="board__toc"
      :acts="acts"
      :chapters-by-act="chaptersByAct"
      :active-chapter-id="activeChapterId"
    />

    <div class="board__acts">
      <section
        v-for="act in acts"
        :id="actAnchorId(act.value)"
        :key="act.value"
        :data-act="act.value"
        class="act"
        @dragover.prevent
        @drop.prevent="dropOnAct(act.value)"
      >
        <header class="act__head">
          <div class="act__label">
            <h3 class="act__title serif">{{ act.label }}</h3>
            <p v-if="act.hint" class="act__hint">{{ act.hint }}</p>
          </div>
          <div class="act__tools">
            <NTag class="act__count" size="tiny" round :bordered="false">
              {{ chaptersByAct[act.value].length }}
            </NTag>
            <!-- 章节多时底部的「新增章节」要滚到很远，幕头再放一个小入口。 -->
            <NButton
              size="tiny"
              quaternary
              class="act__add-head"
              title="在本幕新增章节"
              @click="emit('add-chapter', act.value)"
            >
              ＋
            </NButton>
            <!-- 只允许移除末尾的空幕，避免误删正在写的章节。 -->
            <NButton
              v-if="
                act.value === actCount &&
                act.value > DEFAULT_ACT_COUNT &&
                chaptersByAct[act.value].length === 0
              "
              size="tiny"
              quaternary
              class="act__remove"
              @click="emit('remove-act', act.value)"
            >
              移除
            </NButton>
          </div>
        </header>

        <div class="act__body">
          <OutlineChapterCard
            v-for="chapter in chaptersByAct[act.value]"
            :id="chapterAnchorId(chapter.id)"
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

      <NButton dashed block class="board__add-act" @click="emit('add-act')"> ＋ 新增一幕 </NButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.board {
  display: flex;
  align-items: flex-start;
  gap: t.$space-4;
  min-width: 0;
}

// 目录常驻左侧，跟着页面滚（sticky），长页面里靠它直接跳到某一幕或某一章。
.board__toc {
  position: sticky;
  flex: 0 0 168px;
  top: t.$space-6;
  min-width: 0;
}

// 每一幕占一整行：幕区块自上而下排列，章节在行内按卡片网格铺开。
.board__acts {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: t.$space-4;
  min-width: 0;
}

// 新增一幕用虚线卡片，和「新增章节」保持同一种占位语言。
.board__add-act.board__add-act {
  height: auto;
  min-height: 56px;
  border: 1px dashed var(--divider, #{t.$divider});
  border-radius: t.$radius-lg;
  background: transparent;
  color: var(--text-soft, #{t.$ink-soft});
  font-size: 12px;
  transition:
    border-color t.$duration t.$ease,
    color t.$duration t.$ease;

  &:hover {
    border-color: var(--accent, #{t.$accent});
    color: var(--accent, #{t.$accent});
  }
}

.act {
  min-width: 0;
  padding: t.$space-4;
  // 从目录跳过来时留一点上方余量，幕标题不会贴着滚动容器边缘。
  scroll-margin-top: t.$space-4;
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

  &__tools {
    display: flex;
    flex: none;
    align-items: center;
    gap: t.$space-1;
  }

  // NTag 自带圆角与配色，这里只保证单个数字时的最小宽度。
  &__count {
    min-width: 22px;
    justify-content: center;
  }

  // 移除空幕是低频操作，用更小的字号弱化，避免抢章节的视觉权重。
  &__remove.act__remove {
    font-size: 10px;
  }

  // 列头的「＋」跟列表里的「＋」同一尺寸，保持工具区紧凑。
  &__add-head.act__add-head {
    width: 20px;
    height: 20px;
    min-width: 20px;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    color: var(--text-faint);

    &:hover {
      color: var(--accent, #{t.$accent});
    }
  }

  // 一章一行：每个章节卡横跨整幕宽度，纵向依次排列，章节与场景的从属关系不会被网格切断。
  &__body {
    display: flex;
    flex-direction: column;
    gap: t.$space-3;
    min-width: 0;
    margin-top: t.$space-3;
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

// 章节卡是子组件，跳转落点要在这里补一点上边距，避免被滚动容器的边缘裁掉标题。
:deep(.chapter) {
  scroll-margin-top: t.$space-4;
}

// 内容区太窄时目录让位给章节卡：此时只剩一列，页面本身也不长，滚一下就到。
@container (max-width: 520px) {
  .board__toc {
    display: none;
  }
}
</style>
