<script setup lang="ts">
import { NTag } from "naive-ui";
import { REVIEW_SEVERITY_LABEL, REVIEW_SEVERITY_TAG_TYPE, type ReviewIssue } from "@/types";

/**
 * 一条审稿意见。
 *
 * 结构固定为「级别 + 标题 → 原文 → 为什么是问题 → 怎么改」，
 * 作者扫标题就能判断要不要改，需要时再看细节，避免每条都写成一段长文。
 */
defineProps<{
  issue: ReviewIssue;
}>();
</script>

<template>
  <article class="issue">
    <header class="issue__head">
      <NTag size="small" :bordered="false" :type="REVIEW_SEVERITY_TAG_TYPE[issue.severity]">
        {{ REVIEW_SEVERITY_LABEL[issue.severity] }}
      </NTag>
      <h4 class="issue__title">{{ issue.title }}</h4>
    </header>

    <blockquote v-if="issue.quote" class="issue__quote">{{ issue.quote }}</blockquote>
    <p v-if="issue.detail" class="issue__detail">{{ issue.detail }}</p>
    <p v-if="issue.suggestion" class="issue__suggestion">
      <span class="issue__suggestion-label">建议</span>{{ issue.suggestion }}
    </p>
  </article>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;

.issue {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  padding: t.$space-3;
  border: 1px solid var(--divider, #{t.$divider});
  border-radius: t.$radius-md;
  background: var(--bg-app);

  &__head {
    display: flex;
    align-items: flex-start;
    gap: t.$space-2;
  }

  &__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.6;
    color: var(--text-primary);
  }

  // 引用原文用衬线并压深一档，和说明文字区分开，方便快速定位。
  &__quote {
    margin: 0;
    padding: t.$space-2 t.$space-3;
    border-left: 2px solid var(--accent, #{t.$accent});
    border-radius: 0 t.$radius-sm t.$radius-sm 0;
    background: var(--bg-sunken);
    font-family: var(--font-serif, #{t.$font-serif});
    font-size: 12px;
    line-height: 1.8;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__detail,
  &__suggestion {
    margin: 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__suggestion-label {
    display: inline-block;
    margin-right: t.$space-2;
    padding: 0 4px;
    border-radius: 3px;
    background: var(--bg-sunken);
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}
</style>
