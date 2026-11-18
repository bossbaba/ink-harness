<script setup lang="ts">
import { NEmpty, NTag } from "naive-ui";
import ReviewIssueCard from "@/components/review/ReviewIssueCard.vue";
import {
  REVIEW_LAYER_HINT,
  REVIEW_LAYER_LABEL,
  type ReviewDecision,
  type ReviewIssue,
  type ReviewLayer,
} from "@/types";

/**
 * 审稿报告的一层（结构 / 一致性 / 语言）。
 *
 * 空状态要说明「是没发现问题，还是这层不适用」——全书模式没有正文，
 * 语言层本就不该有结论，直接写「没有问题」会误导作者。
 */
defineProps<{
  layer: ReviewLayer;
  issues: ReviewIssue[];
  /** 审读进行中：这一层还没有结论，显示等待而不是「没问题」。 */
  running: boolean;
  /** 该层不适用的原因（如全书模式下的语言层）。 */
  note?: string;
  /** 本章模式：采纳的修改可以写回正文。 */
  canApply: boolean;
}>();

const emit = defineEmits<{
  decide: [id: string, decision: ReviewDecision];
  comment: [id: string, text: string];
}>();
</script>

<template>
  <section class="layer">
    <header class="layer__head">
      <h3 class="layer__title">{{ REVIEW_LAYER_LABEL[layer] }}</h3>
      <NTag class="layer__count" size="tiny" round :bordered="false">{{ issues.length }}</NTag>
      <span class="layer__hint">{{ REVIEW_LAYER_HINT[layer] }}</span>
    </header>

    <NEmpty
      v-if="running"
      class="layer__empty"
      size="tiny"
      :show-icon="false"
      description="审读中…"
    />
    <NEmpty
      v-else-if="note"
      class="layer__empty"
      size="tiny"
      :show-icon="false"
      :description="note"
    />
    <NEmpty
      v-else-if="issues.length === 0"
      class="layer__empty"
      size="tiny"
      :show-icon="false"
      description="这一层没有发现问题。"
    />
    <div v-else class="layer__list">
      <ReviewIssueCard
        v-for="issue in issues"
        :key="issue.id"
        :issue="issue"
        :can-apply="canApply"
        @decide="(id, decision) => emit('decide', id, decision)"
        @comment="(id, text) => emit('comment', id, text)"
      />
    </div>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.layer {
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
    color: var(--text-primary, #{t.$ink});
  }

  // NTag 自带圆角与配色，这里只保证单个数字时也有稳定的最小宽度。
  &__count {
    min-width: 18px;
    justify-content: center;
  }

  &__hint {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: t.$space-3;
    margin-top: t.$space-3;
    min-width: 0;
  }

  // 空状态保持紧凑：一句说明，不留大片空白。
  &__empty {
    margin: t.$space-3 0 0;
    font-size: 11px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }
}
</style>
