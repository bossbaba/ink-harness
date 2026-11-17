<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NRadioButton, NRadioGroup, NSelect } from "naive-ui";
import { computed, onMounted, ref, watch } from "vue";
import ReviewLayerSection from "@/components/review/ReviewLayerSection.vue";
import { useProjectReview } from "@/composables/useProjectReview";
import { reviewToMarkdown } from "@/services/reviewService";
import { REVIEW_LAYER_ORDER } from "@/types";

/**
 * 作品审稿页：选范围 → 跑一致性检查与模型审读 → 按结构/一致性/语言三层看报告。
 *
 * 页面只负责组装与展示，请求、取消、解析都在 useProjectReview 里；
 * 报告不落库，需要留存就复制成 Markdown。
 */
const props = defineProps<{
  projectId: string;
}>();

const {
  project,
  loading,
  loadError,
  scope,
  chapterId,
  chapterOptions,
  canRun,
  running,
  progress,
  received,
  error,
  report,
  grouped,
  load,
  run,
  stop,
  reset,
} = useProjectReview(props.projectId);

const copied = ref(false);

const pageTitle = computed(() =>
  project.value ? `《${project.value.title}》· 编辑审稿` : "编辑审稿",
);

/** 全书模式没有正文，语言层必须说明「不检查」而不是「没问题」。 */
const languageNote = computed(() =>
  scope.value === "book"
    ? "全书模式只有目录与摘要，不检查语言；要逐章看用词与句式，请切到「本章」。"
    : undefined,
);

const summary = computed(() => {
  const value = report.value;
  if (!value) return "";
  return [
    value.target,
    value.model ? `模型 ${value.model}` : "",
    `问题 ${value.issues.length} 条`,
    value.createdAt,
  ]
    .filter(Boolean)
    .join(" · ");
});

onMounted(() => void load());

// 范围或章节一换，旧报告就不再对应当前文本，直接清掉避免误读。
watch([scope, chapterId], () => reset());

async function startReview(): Promise<void> {
  if (!canRun.value) return;
  await run();
}

async function copyReport(): Promise<void> {
  if (!report.value) return;
  try {
    await navigator.clipboard.writeText(reviewToMarkdown(report.value));
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // 剪贴板不可用时静默失败，作者仍可手动选中报告文字复制。
  }
}
</script>

<template>
  <div class="review">
    <header class="review__header">
      <div>
        <h1 class="review__title serif">{{ pageTitle }}</h1>
        <p class="review__subtitle">
          一致性由设定库规则直接检查，结构与语言交给模型。报告只作参考，改稿请回写作台。
        </p>
      </div>
    </header>

    <p v-if="loadError" class="review__error">{{ loadError }}</p>

    <section class="controls">
      <div class="controls__row">
        <NRadioGroup v-model:value="scope" size="small" :disabled="running">
          <NRadioButton value="chapter">本章</NRadioButton>
          <NRadioButton value="book">全书概览</NRadioButton>
        </NRadioGroup>

        <NSelect
          v-if="scope === 'chapter'"
          v-model:value="chapterId"
          class="controls__chapter"
          size="small"
          :options="chapterOptions"
          :disabled="running || loading || chapterOptions.length === 0"
          placeholder="选择章节"
        />

        <span class="controls__spacer" />

        <MacButton v-if="running" size="regular" @click="stop">停止</MacButton>
        <MacButton
          v-else
          size="regular"
          variant="prominent"
          :disabled="!canRun"
          @click="startReview"
        >
          {{ report ? "重新审读" : "开始审读" }}
        </MacButton>
      </div>

      <p v-if="running" class="controls__status">
        {{ progress || "准备中…" }}
        <template v-if="received">已收到 {{ received }} 字</template>
      </p>
      <p v-else-if="loading" class="controls__hint">正在读取作品与章节…</p>
      <p v-else-if="scope === 'chapter' && chapterOptions.length === 0" class="controls__hint">
        这部作品还没有章节，先去大纲建一章再来审。
      </p>
    </section>

    <p v-if="error" class="review__error">{{ error }}</p>

    <section v-if="report?.raw" class="raw">
      <header class="raw__head">
        <h2 class="raw__title">模型原始输出（未能解析成条目）</h2>
        <span class="raw__hint">可复制出来手工整理</span>
      </header>
      <pre class="raw__text">{{ report.raw }}</pre>
    </section>

    <template v-if="report">
      <div class="summary">
        <p class="summary__text">{{ summary }}</p>
        <MacButton size="regular" @click="copyReport">{{
          copied ? "已复制" : "复制报告"
        }}</MacButton>
        <RouterLink
          v-if="report.scope === 'chapter' && chapterId"
          class="summary__link"
          :to="{ name: 'project-writing', params: { projectId, chapterId } }"
        >
          去写作台改这一章 →
        </RouterLink>
      </div>

      <ReviewLayerSection
        v-for="layer in REVIEW_LAYER_ORDER"
        :key="layer"
        :layer="layer"
        :issues="grouped[layer]"
        :running="false"
        :note="layer === 'language' ? languageNote : undefined"
      />
    </template>

    <section v-else-if="!running" class="placeholder">
      <p class="placeholder__title">还没有审稿报告。</p>
      <p class="placeholder__hint">
        选「本章」可以连语言一起看；选「全书概览」只根据目录与摘要检查结构与一致性，速度快、不读正文。
      </p>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.review {
  max-width: 1000px;
  min-width: 0;
  margin: 0 auto;
  padding: t.$space-6;
  container-type: inline-size;

  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-4;
  }

  &__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  &__subtitle {
    margin: t.$space-2 0 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__error {
    margin: t.$space-3 0 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--error, #{t.$error});
  }
}

.controls {
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-3;
    min-width: 0;
  }

  &__chapter {
    width: 220px;
    min-width: 0;
  }

  &__spacer {
    flex: 1;
  }

  &__status,
  &__hint {
    margin: t.$space-2 0 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: t.$space-3;
  margin-top: t.$space-4;
  padding: t.$space-3 t.$space-4;
  border: 1px solid var(--divider, #{t.$divider});
  border-radius: t.$radius-lg;
  background: var(--bg-sunken);

  &__text {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__link {
    font-size: 11px;
    color: var(--accent, #{t.$accent});
    text-decoration: none;
  }
}

.raw {
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: t.$space-2;
  }

  &__title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  &__hint {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__text {
    max-height: 320px;
    margin: t.$space-3 0 0;
    overflow: auto;
    padding: t.$space-3;
    border-radius: t.$radius-md;
    background: var(--bg-app);
    font-size: 11px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-soft, #{t.$ink-soft});
    @include m.thin-scrollbar;
  }
}

// 空状态保持紧凑，只说明下一步该做什么。
.placeholder {
  margin-top: t.$space-4;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  &__hint {
    margin: t.$space-2 0 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

@container (max-width: 620px) {
  .controls__row {
    align-items: stretch;
  }

  .controls__chapter {
    width: 100%;
  }
}
</style>
