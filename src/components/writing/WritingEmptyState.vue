<script setup lang="ts">
import AppEmpty from "@/components/common/AppEmpty.vue";

/**
 * 写作台编辑区的空状态：一句说明 + 一句提示 + 可选的行动入口。
 *
 * 抽成组件是因为「未选章」与「正文载入失败」两处文案不同、结构一样，
 * 各写一份容易漏掉行动按钮或空状态高度不一致。
 * 视觉统一走 AppEmpty（图标徽章 + 双行文案），这里只负责写作台的文案口径。
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
  <AppEmpty
    icon="write"
    :title="title"
    :description="hint"
    :action-label="actionLabel"
    @action="emit('action')"
  />
</template>
