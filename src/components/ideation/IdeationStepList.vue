<script setup lang="ts">
import { NButton } from "naive-ui";
import { IDEATION_STEPS } from "@/types";

// 左侧步骤条：只负责展示与派发跳转，是否可达由父级的 maxReachable 决定。
defineProps<{
  current: number;
  maxReachable: number;
}>();

const emit = defineEmits<(e: "select", index: number) => void>();
</script>

<template>
  <aside class="steps">
    <!-- 步骤项用 NButton text 变体承载点击与禁用态，视觉仍是圆形序号 + 双行文案。 -->
    <NButton
      v-for="(item, index) in IDEATION_STEPS"
      :key="item.label"
      text
      block
      class="step"
      :class="{ 'step--active': index === current, 'step--done': index < current }"
      :disabled="index > maxReachable"
      @click="emit('select', index)"
    >
      <span class="step__index">{{ index + 1 }}</span>
      <span class="step__body">
        <span class="step__label">{{ item.label }}</span>
        <span class="step__hint">{{ item.hint }}</span>
      </span>
    </NButton>
  </aside>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.steps {
  display: flex;
  flex-direction: column;
  gap: t.$space-1;
  min-width: 0;
  padding: t.$space-3;
  @include m.card-surface(var(--bg-surface));
}

.step {
  display: flex;
  align-items: flex-start;
  gap: t.$space-2;
  width: 100%;
  padding: t.$space-2;
  border: none;
  border-radius: t.$radius-sm;
  background: transparent;
  color: var(--text-soft, #{t.$ink-soft});
  text-align: left;
  cursor: pointer;
  transition: background t.$duration t.$ease, color t.$duration t.$ease;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &:not(:disabled):hover {
    background: var(--bg-hover);
  }

  &--active {
    background: var(--bg-sunken);
    color: var(--text-primary, #{t.$ink});
  }

  &__index {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border: 1px solid var(--divider, #{t.$divider});
    border-radius: 50%;
    font-size: 10px;
  }

  &--active &__index,
  &--done &__index {
    border-color: var(--accent, #{t.$accent});
    color: var(--accent, #{t.$accent});
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  &__label {
    font-size: 12px;
    font-weight: 600;
  }

  &__hint {
    font-size: 10px;
    line-height: 1.5;
    color: var(--text-faint, #{t.$ink-faint});
  }
}

// NButton text 变体注入的样式优先级高，这里双写类名覆盖关键布局属性与选中态。
.step.step {
  padding: t.$space-2;
  border: none;
  background: transparent;
  font-size: inherit;
  text-align: left;
  white-space: normal;

  // NButton 把 slot 内容包进 .n-button__content，序号与正文要在这一层做 flex，
  // 否则写在按钮根上的 flex 只作用于唯一的内容包装层，两个子元素会挤在一起。
  :deep(.n-button__content) {
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    gap: t.$space-2;
    width: 100%;
    white-space: normal;
  }

  &.step--active {
    background: var(--bg-sunken);
    color: var(--text-primary, #{t.$ink});
  }
}
</style>
