<script setup lang="ts">
import { NButton } from "naive-ui";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Act, Chapter } from "@/types";
import { actAnchorId, chapterAnchorId } from "./outlineAnchors";

/**
 * 大纲目录：按幕列出章节，点击平滑滚动到对应的幕/章节。
 * 只负责导航与「当前幕」提示，章节数据仍由页面/composable 提供。
 */
const props = defineProps<{
  acts: Array<{ value: Act; label: string; hint: string }>;
  chaptersByAct: Record<number, Chapter[]>;
  activeChapterId: string;
}>();

/** 当前滚动位置所在的幕，用于目录高亮；初始按第一幕算。 */
const currentAct = ref(props.acts[0]?.value ?? 1);

let observer: IntersectionObserver | null = null;

/**
 * 用「顶部窄带」判定当前幕：幕区块滚到这条带里就算当前幕。
 * 滚动容器是 AppShell 的 .content，用 viewport 做 root 时同样成立。
 */
function observeActs(): void {
  observer?.disconnect();
  if (typeof IntersectionObserver === "undefined") return;

  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const act = Number(visible[0]?.target.getAttribute("data-act") ?? 0);
      // 快速滚动时可能整帧都在带外，这时保留上一次的幕，不要跳回第一幕。
      if (act) currentAct.value = act;
    },
    // 只把视口上部 20%~35% 这一段当作判定带：幕太高时也不会同时命中好几幕。
    { rootMargin: "-20% 0px -65% 0px", threshold: 0 },
  );

  for (const act of props.acts) {
    const element = document.getElementById(actAnchorId(act.value));
    if (element) observer.observe(element);
  }
}

function scrollTo(anchorId: string): void {
  document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function jumpAct(act: Act): void {
  currentAct.value = act;
  scrollTo(actAnchorId(act));
}

function jumpChapter(chapterId: string): void {
  scrollTo(chapterAnchorId(chapterId));
}

// 幕数量变化（新增/移除幕）会改变观察目标，重新挂一遍。
watch(() => props.acts.map((act) => act.value).join(","), observeActs);

onMounted(observeActs);
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <nav class="toc" aria-label="大纲目录">
    <p class="toc__head">目录</p>

    <div class="toc__body">
      <div v-for="act in acts" :key="act.value" class="toc__group">
        <NButton
          text
          block
          class="toc__act"
          :class="{ 'toc__act--active': currentAct === act.value }"
          @click="jumpAct(act.value)"
        >
          <span class="toc__act-name">{{ act.label }}</span>
          <span class="toc__act-count">{{ chaptersByAct[act.value].length }}</span>
        </NButton>

        <NButton
          v-for="(chapter, index) in chaptersByAct[act.value]"
          :key="chapter.id"
          text
          block
          class="toc__chapter"
          :class="{ 'toc__chapter--active': chapter.id === activeChapterId }"
          @click="jumpChapter(chapter.id)"
        >
          <span class="toc__order">{{ index + 1 }}</span>
          <span class="toc__title">{{ chapter.title }}</span>
        </NButton>
      </div>
    </div>
  </nav>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.toc {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-height: calc(100vh - #{t.$space-8});
  padding-right: t.$space-2;
  overflow: hidden;

  &__head {
    flex: none;
    margin: 0 0 t.$space-2;
    padding-left: t.$space-2;
    font-size: 11px;
    color: var(--text-faint);
  }

  &__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    @include m.thin-scrollbar;
  }

  &__group + &__group {
    margin-top: t.$space-2;
  }
}

// NButton text 自带内边距与居中，这里双写类名把它压成导航条目的样子。
.toc__act.toc__act {
  justify-content: space-between;
  width: 100%;
  height: auto;
  padding: 4px t.$space-2;
  border-radius: t.$radius-sm;
  font-size: 12px;
  color: var(--text-primary);
  text-align: left;

  :deep(.n-button__content) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
    width: 100%;
    min-width: 0;
  }

  &:hover {
    background: var(--bg-sunken);
  }

  &--active {
    background: var(--bg-sunken);
    font-weight: 600;
  }
}

.toc__act-name {
  @include m.ellipsis;
}

.toc__act-count {
  flex: none;
  font-size: 10px;
  font-weight: 400;
  color: var(--text-faint);
}

.toc__chapter.toc__chapter {
  justify-content: flex-start;
  width: 100%;
  height: auto;
  padding: 3px t.$space-2 3px t.$space-4;
  border-radius: t.$radius-sm;
  font-size: 11px;
  color: var(--text-soft);
  text-align: left;

  :deep(.n-button__content) {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    width: 100%;
    min-width: 0;
  }

  &:hover {
    background: var(--bg-sunken);
    color: var(--text-primary);
  }

  &--active {
    color: var(--accent, #{t.$accent});
  }
}

.toc__order {
  flex: none;
  width: 12px;
  color: var(--text-faint);
}

.toc__title {
  @include m.ellipsis;
}
</style>
