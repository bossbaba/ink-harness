<script setup lang="ts">
import { NButton } from "naive-ui";
import { useNotice } from "@/composables/useNotice";

/**
 * 全局提示栈的渲染层。
 * 用 `role="alert"` + `aria-live="assertive"`：读屏软件会把失败原因念出来，
 * 而不是只把红字画在角落。
 */
const { notices, dismiss } = useNotice();
</script>

<template>
  <div v-if="notices.length > 0" class="notice-stack" role="alert" aria-live="assertive">
    <div v-for="item in notices" :key="item.id" class="notice" :class="`notice--${item.level}`">
      <span class="notice__text">{{ item.message }}</span>
      <NButton quaternary size="tiny" @click="dismiss(item.id)">关闭</NButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/tokens" as t;

.notice-stack {
  position: fixed;
  right: t.$space-6;
  bottom: t.$space-6;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  // 面板宽度自适应窗口，但不允许撑破窄窗口
  width: min(420px, calc(100vw - #{t.$space-6} * 2));
  container-type: inline-size;
}

.notice {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: t.$space-3;
  padding: t.$space-3 t.$space-4;
  border-radius: t.$radius-lg;
  border: 1px solid var(--divider, #{t.$divider});
  background: var(--bg-surface, #{t.$paper-raised});
  box-shadow: t.$shadow-card;

  &--error {
    border-color: var(--error, #{t.$error});
  }

  &--info {
    border-color: var(--border, #{t.$divider});
  }
}

.notice__text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary, #{t.$ink});
  word-break: break-word;
}

.notice--error .notice__text {
  color: var(--error, #{t.$error});
}
</style>
