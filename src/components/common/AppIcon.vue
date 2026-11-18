<script setup lang="ts">
import { computed } from "vue";
import { type AppIconName, appIconPaths } from "./appIcons";

/**
 * 统一图标组件：把语义图标渲染成描边 SVG。
 * 用 currentColor 上色，因此按钮、导航、状态文字的图标会自动跟随各自前景色，
 * 不需要为明暗主题各写一份颜色。
 */
const props = withDefaults(
  defineProps<{
    name: AppIconName;
    /** 图标边长，默认 16px，与正文行高匹配。 */
    size?: number;
    /** 描边粗细，默认 1.6，比 1px 更接近 SF Symbols 的视觉重量。 */
    strokeWidth?: number;
  }>(),
  { size: 16, strokeWidth: 1.6 },
);

const paths = computed(() => appIconPaths[props.name] ?? []);
</script>

<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    :stroke-width="strokeWidth"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(path, index) in paths" :key="index" :d="path" />
  </svg>
</template>

<style scoped lang="scss">
.app-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: -0.15em;
}
</style>
