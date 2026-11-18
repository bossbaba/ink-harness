<script setup lang="ts">
import { NButton, NInput, NTag } from "naive-ui";
import { computed } from "vue";
import {
  REVIEW_DECISION_LABEL,
  REVIEW_DECISION_TAG_TYPE,
  REVIEW_SEVERITY_LABEL,
  REVIEW_SEVERITY_TAG_TYPE,
  type ReviewDecision,
  type ReviewIssue,
} from "@/types";
import { diffText } from "@/utils/textDiff";

/**
 * 一条审稿意见：标题 → 原文/建议的 Diff → 为什么 → 怎么改 → 逐条审阅。
 *
 * 只有采纳且带替换文本的条目能一键写回正文；纯方向性建议也能采纳，
 * 但会明确提示作者手工改，避免把「建议丰富描写」这类空话塞进稿子。
 */
const props = defineProps<{
  issue: ReviewIssue;
  /** 本章模式：全书只有目录与摘要，没有正文可改。 */
  canApply: boolean;
}>();

const emit = defineEmits<{
  decide: [id: string, decision: ReviewDecision];
  comment: [id: string, text: string];
}>();

/** 把 quote → replacement 做成增删改片段，删的标红、增的标绿。 */
const segments = computed(() =>
  props.issue.replacement ? diffText(props.issue.quote, props.issue.replacement) : [],
);
</script>

<template>
  <article class="issue">
    <header class="issue__head">
      <NTag size="small" :bordered="false" :type="REVIEW_SEVERITY_TAG_TYPE[issue.severity]">
        {{ REVIEW_SEVERITY_LABEL[issue.severity] }}
      </NTag>
      <h4 class="issue__title">{{ issue.title }}</h4>
      <NTag
        v-if="issue.decision !== 'pending'"
        size="small"
        :bordered="false"
        :type="REVIEW_DECISION_TAG_TYPE[issue.decision]"
      >
        {{ REVIEW_DECISION_LABEL[issue.decision] }}
      </NTag>
    </header>

    <blockquote v-if="issue.quote && segments.length === 0" class="issue__quote">
      {{ issue.quote }}
    </blockquote>

    <div v-if="segments.length > 0" class="diff">
      <span class="diff__label">原文 → 建议</span>
      <p class="diff__text">
        <span
          v-for="(segment, index) in segments"
          :key="index"
          class="diff__seg"
          :class="`diff__seg--${segment.kind}`"
          >{{
            segment.text
          }}</span
        >
      </p>
    </div>

    <p v-if="issue.detail" class="issue__detail">{{ issue.detail }}</p>
    <p v-if="issue.suggestion" class="issue__suggestion">
      <span class="issue__suggestion-label">建议</span>{{ issue.suggestion }}
    </p>

    <div class="issue__review">
      <NInput
        :value="issue.comment"
        type="textarea"
        size="small"
        :autosize="{ minRows: 1, maxRows: 4 }"
        placeholder="补一句批注（可选）"
        @update:value="(text: string) => emit('comment', issue.id, text)"
      />
      <div class="issue__actions">
        <NButton
          size="small"
          :disabled="issue.decision === 'applied'"
          @click="emit('decide', issue.id, 'accepted')"
        >
          {{ issue.decision === "accepted" || issue.decision === "applied" ? "已采纳" : "接受" }}
        </NButton>
        <NButton
          size="small"
          :disabled="issue.decision === 'applied'"
          @click="emit('decide', issue.id, 'rejected')"
        >
          {{ issue.decision === "rejected" ? "已忽略" : "忽略" }}
        </NButton>
      </div>
    </div>

    <p v-if="issue.decision === 'accepted' && !issue.replacement" class="issue__hint">
      {{
        canApply
          ? "这条没有可直接替换的文本，请回写作台按建议手工改。"
          : "全书模式没有正文，这条采纳后需到对应章节手工改。"
      }}
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
  min-width: 0;

  &__head {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: t.$space-2;
  }

  &__title {
    flex: 1;
    min-width: 0;
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

  &__review {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    margin-top: t.$space-1;
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: t.$space-2;
  }

  &__hint {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--warning, #{t.$warning});
  }
}

.diff {
  padding: t.$space-2 t.$space-3;
  border-radius: t.$radius-md;
  background: var(--bg-sunken);
  min-width: 0;

  &__label {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__text {
    margin: t.$space-1 0 0;
    font-family: var(--font-serif, #{t.$font-serif});
    font-size: 12px;
    line-height: 1.8;
    color: var(--text-primary);
    word-break: break-word;
  }

  // 同一段正文里删改并用：删除线标原文、加粗标替换后的字。
  &__seg--del {
    color: var(--error, #{t.$error});
    text-decoration: line-through;
  }

  &__seg--add {
    color: var(--success, #{t.$success});
    font-weight: 600;
  }
}
</style>
