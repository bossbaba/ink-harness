<script setup lang="ts">
import { computed } from "vue";
import { type AppIconName, appIconPaths } from "./appIcons";
import { designIconShapes } from "./designIconShapes";

/**
 * 统一图标组件：优先渲染 Ardot 设计稿的 24×24 矢量（填充/描边混合），
 * 设计稿未覆盖的图标回落到 16×16 描边路径（appIcons.ts）。
 *
 * 两套矢量都用 currentColor 上色，因此按钮、导航、状态文字的图标会自动跟随
 * 各自前景色，明暗主题无需各写一份颜色。
 */
const props = withDefaults(
  defineProps<{
    name: AppIconName;
    /** 图标边长，默认 18px，与设计稿侧栏图标一致。 */
    size?: number;
    /** 描边粗细，仅对 16×16 回落图标生效，默认 1.6。 */
    strokeWidth?: number;
  }>(),
  { size: 18, strokeWidth: 1.6 },
);

/** 设计稿矢量：命中使用 24×24 渲染，未命中则回落旧描边图标。 */
const shapes = computed(() => designIconShapes[props.name]);
const paths = computed(() => (shapes.value ? [] : (appIconPaths[props.name] ?? [])));
</script>

<template>
  <!-- 设计稿 24×24 图标：每个形状独立决定填充还是描边，平移直接烘焙进元素 transform。 -->
  <svg
    v-if="shapes"
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <g>
      <template v-for="(shape, index) in shapes" :key="index">
        <path
          v-if="shape.t === 'p'"
          :d="shape.d"
          :transform="shape.tr ? `translate(${shape.tr[0]} ${shape.tr[1]})` : undefined"
          :fill="shape.f ? 'currentColor' : 'none'"
          :stroke="shape.f ? 'none' : 'currentColor'"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <rect
          v-else-if="shape.t === 'r'"
          :x="shape.x"
          :y="shape.y"
          :width="shape.w"
          :height="shape.h"
          :rx="shape.r ?? 0"
          :transform="shape.tr ? `translate(${shape.tr[0]} ${shape.tr[1]})` : undefined"
          :fill="shape.f ? 'currentColor' : 'none'"
          :stroke="shape.f ? 'none' : 'currentColor'"
          stroke-width="1.7"
          stroke-linecap="round"
        />
        <circle
          v-else-if="shape.t === 'c'"
          :cx="shape.cx"
          :cy="shape.cy"
          :r="shape.r"
          :transform="shape.tr ? `translate(${shape.tr[0]} ${shape.tr[1]})` : undefined"
          :fill="shape.f ? 'currentColor' : 'none'"
          :stroke="shape.f ? 'none' : 'currentColor'"
          stroke-width="1.7"
        />
        <ellipse
          v-else-if="shape.t === 'e'"
          :cx="shape.cx"
          :cy="shape.cy"
          :rx="shape.rx"
          :ry="shape.ry"
          :transform="shape.tr ? `translate(${shape.tr[0]} ${shape.tr[1]})` : undefined"
          :fill="shape.f ? 'currentColor' : 'none'"
          :stroke="shape.f ? 'none' : 'currentColor'"
          stroke-width="1.7"
        />
      </template>
    </g>
  </svg>

  <!-- 回落图标：保持原有 16×16 描边路径，调用方无需改动。 -->
  <svg
    v-else
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
