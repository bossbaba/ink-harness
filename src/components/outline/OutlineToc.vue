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
          :class="{
            'toc__act--active': currentAct === act.value,
            'toc__act--empty': chaptersByAct[act.value].length === 0,
          }"
          @click="jumpAct(act.value)"
        >
          <span class="toc__act-name">{{ act.label }}</span>
          <!-- 空幕显示「空」而不是 0：目录里 0 容易被读成「第 0 章」。 -->
          <span class="toc__act-count">{{ chaptersByAct[act.value].length || "空" }}</span>
        </NButton>

        <!--
          不再显示幕内序号：章节标题本身已带「第X章」，再放一个从 1 开始的编号
          会和标题里的全局章号打架（第二幕第 1 条其实是第七章）。
          省下来的宽度全部给标题，长章节名才不至于刚开头就被截断。
        -->
        <NButton
          v-for="chapter in chaptersByAct[act.value]"
          :key="chapter.id"
          text
          block
          class="toc__chapter"
          :class="{ 'toc__chapter--active': chapter.id === activeChapterId }"
          :title="chapter.title"
          @click="jumpChapter(chapter.id)"
        >
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
  // 目录是导航不是正文：高度封顶到视口留白，内容少时由内容决定，不会出现半屏空白。
  max-height: calc(100vh - 160px);
  padding-right: t.$space-1;
  overflow: hidden;

  &__head {
    flex: none;
    margin: 0 0 t.$space-2;
    // 与条目左内边距对齐，标题不会比下面的「第一幕」更靠左。
    padding: 0 t.$space-2 t.$space-2;
    border-bottom: 1px solid var(--divider, #{t.$divider});
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    @include m.thin-scrollbar;
  }

  // 幕之间留出比章节更大的间距，层级先靠留白立住；
  // 长目录里再加一条极淡虚线，滚动时能快速判断「已经在下一幕了」。
  &__group + &__group {
    margin-top: t.$space-3;
    padding-top: t.$space-2;
    border-top: 1px dashed var(--divider, #{t.$divider});
  }
}

// NButton text 自带内边距与居中，这里双写类名把它压成导航条目的样子。
.toc__act.toc__act {
  justify-content: space-between;
  width: 100%;
  height: auto;
  // 行高压到 5px 上下内边距：目录条目要有足够的点击面积，又不能把一屏塞满。
  padding: 5px t.$space-2;
  border-radius: t.$radius-sm;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
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

  // 当前幕用「浅底 + 左侧 2px 主色条」：只改底色的话，和 hover 态几乎分不出来。
  &--active {
    background: var(--bg-sunken);
    box-shadow: inset 2px 0 0 var(--accent, #{t.$accent});
    font-weight: 600;
  }

  // 空幕降低对比度：它没有内容可跳，视觉上不该和有章节的幕一样重。
  &--empty {
    font-weight: 500;
    color: var(--text-soft, #{t.$ink-soft});
  }
}

.toc__act-name {
  @include m.ellipsis;
}

.toc__act-count {
  // 等宽数字：1 和 10 的右边缘才对得齐；空幕的「空」也不至于比数字更抢眼。
  flex: none;
  font-size: 10px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  color: var(--text-faint, #{t.$ink-faint});
}

.toc__chapter.toc__chapter {
  justify-content: flex-start;
  width: 100%;
  height: auto;
  // 左缩进 12px 形成「幕 > 章」的层级；上下 4px 保证行高够点，不会误点到隔壁。
  padding: 4px t.$space-2 4px 12px;
  border-radius: t.$radius-sm;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-soft);
  text-align: left;

  :deep(.n-button__content) {
    display: flex;
    align-items: center;
    gap: t.$space-1;
    width: 100%;
    min-width: 0;
  }

  &:hover {
    background: var(--bg-sunken);
    color: var(--text-primary);
  }

  // 当前章节：浅主色底 + 左侧主色条，与「当前幕」用同一套指示语言。
  &--active {
    color: var(--accent, #{t.$accent});
    background: var(--accent-soft, #{t.$accent-soft});
    box-shadow: inset 2px 0 0 var(--accent, #{t.$accent});
    font-weight: 500;
  }
}

.toc__title {
  // flex 子项必须显式 min-width: 0，否则长标题会撑开容器而不是显示省略号。
  min-width: 0;
  @include m.ellipsis;
}
</style>
