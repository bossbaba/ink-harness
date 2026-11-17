<script setup lang="ts">
import { MacButton } from "@macvue/core";

/**
 * 写作台编辑区的空状态：一句说明 + 一句提示 + 可选的行动入口。
 *
 * 抽成组件是因为「未选章」与「正文载入失败」两处文案不同、结构一样，
 * 各写一份容易漏掉行动按钮或空状态高度不一致。
 */
defineProps<{
  /** 主说明，说清当前为什么没内容。 */
  title: string;
  /** 下一步该怎么做；不传就只显示主说明。 */
  hint?: string;
  /** 行动按钮文案；不传则不渲染按钮。 */
  actionLabel?: string;
}>();

const emit = defineEmits<(event: "action") => void>();
</script>

<template>
  <div class="empty">
    <p>{{ title }}</p>
    <p v-if="hint" class="empty__hint">{{ hint }}</p>
    <MacButton v-if="actionLabel" size="regular" @click="emit('action')">
      {{ actionLabel }}
    </MacButton>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;

// 高度由内容决定并留一点余量，避免空状态铺满整个编辑区显得空荡。
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: t.$space-3;
  min-height: 220px;
  padding: t.$space-6;
  text-align: center;
  font-size: 13px;
  color: var(--text-faint, #{t.$ink-faint});

  p {
    margin: 0;
  }

  &__hint {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}
</style>
