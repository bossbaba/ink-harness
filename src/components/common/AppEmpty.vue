<script setup lang="ts">
import { NButton } from "naive-ui";
import AppIcon from "@/components/common/AppIcon.vue";
import type { AppIconName } from "@/components/common/appIcons";

/**
 * 页面级空状态：图标徽章 + 标题 + 说明 + 可选行动按钮。
 *
 * 之前各页直接摆 NEmpty 的小图标加一行灰字，第一眼像「没加载出来」而不是
 * 「这里等着你开始」。统一成带底色徽章的双行文案后，空状态有了视觉锚点，
 * 同时守住规范：总高由内容决定且不超过 220px，始终带一句说明与一个行动入口。
 * 弹窗、列表分组等密集场景仍用小号 NEmpty，不套这个大状态。
 */
defineProps<{
  /** 徽章图标，默认工作台图标。 */
  icon?: AppIconName;
  /** 主标题：说清这里为什么是空的。 */
  title: string;
  /** 补充说明：告诉用户下一步做什么。 */
  description?: string;
  /** 行动按钮文案；不传则不渲染按钮。 */
  actionLabel?: string;
  /** 按钮类型；主行动默认 primary，次级动作传 default。 */
  actionType?: "primary" | "default";
}>();

const emit = defineEmits<{ action: [] }>();
</script>

<template>
  <div class="app-empty">
    <span class="app-empty__badge">
      <AppIcon :name="icon ?? 'workspace'" :size="22" />
    </span>
    <p class="app-empty__title">{{ title }}</p>
    <p v-if="description" class="app-empty__desc">{{ description }}</p>
    <NButton
      v-if="actionLabel"
      size="small"
      :type="actionType ?? 'primary'"
      @click="emit('action')"
    >
      {{ actionLabel }}
    </NButton>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;

.app-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: t.$space-3;
  // 规范要求空状态不超过 220px：180px 起步居中，内容多时由文案自然撑开。
  min-height: 180px;
  max-width: 420px;
  margin: 0 auto;
  padding: t.$space-5 t.$space-4;
  text-align: center;

  &__badge {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    color: var(--accent, #{t.$accent});
    background: var(--accent-soft, #{t.$accent-soft});
    border-radius: t.$radius-lg;
  }

  &__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__desc {
    margin: 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
  }
}
</style>
