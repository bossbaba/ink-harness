<script setup lang="ts">
import { NRadioButton, NRadioGroup } from "naive-ui";
import type { SegmentOption } from "./segmentedControl";

/**
 * 分段控件的薄封装：用 Naive UI 的 NRadioGroup + NRadioButton 表达单选切换。
 * 保留 options 数组接口，调用方不必在每处重复写 NRadioButton 子节点。
 */
withDefaults(
  defineProps<{
    options: SegmentOption[];
    modelValue: string;
    /** regular 用于页面级切换，small 用于卡片内切换。 */
    size?: "regular" | "small";
    /** 窄侧栏里选项一行放不下时开启：改为可换行的独立胶囊，避免溢出卡片。 */
    wrap?: boolean;
  }>(),
  { size: "regular", wrap: false },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

/** NRadioGroup 可能给出 number/boolean，这里统一收窄成调用方使用的 string。 */
function onChange(value: string | number | boolean): void {
  emit("update:modelValue", String(value));
}
</script>

<template>
  <NRadioGroup
    class="segmented"
    :class="{ 'segmented--wrap': wrap }"
    :value="modelValue"
    :size="size === 'small' ? 'small' : 'medium'"
    @update:value="onChange"
  >
    <NRadioButton
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :disabled="option.disabled"
    >
      {{ option.label }}
    </NRadioButton>
  </NRadioGroup>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;

.segmented {
  max-width: 100%;

  // 默认按钮内边距偏紧，补足文字左右留白，与 NSelect/NInput 的输入区对齐。
  :deep(.n-radio-button) {
    padding-inline: 12px;
  }

  // 窄侧栏专用：NRadioGroup 按钮模式本身是 inline-block + nowrap 的连体布局，
  // 且 Naive 自带的 .n-radio-group--button-group 优先级等于这里的单类名，
  // 所以双写类名压过它，把 nowrap / 固定高度改成可换行的 flex，再拆成独立胶囊。
  &.segmented--wrap.segmented--wrap {
    display: flex;
    flex-wrap: wrap;
    min-width: 0;
    width: 100%;
    white-space: normal;
    height: auto;
    gap: t.$space-1;

    // 连体分隔线在换行后会错位，隐藏后由每个按钮自身的边框分隔。
    :deep(.n-radio-group__splitor) {
      display: none;
    }

    :deep(.n-radio-button) {
      // Naive 给按钮模式设了 line-height = 按钮高度，文字靠 inline 基线对齐，
      // 拆成独立胶囊后会略微偏下；改用 flex 居中并重置行高，让上下留白一致。
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: normal;
      // 窄栏里把左右留白收窄，让更多选项挤进一行。
      padding-inline: 8px;
      border-left-width: 1px;
      border-right-width: 1px;
      border-left-style: solid;
      border-right-style: solid;
      border-radius: var(--n-button-border-radius);
    }

    // 非选中按钮的边框色跟随主题边框变量；选中态交给 Naive 自己的规则，
    // 否则会把高亮色覆盖掉。
    :deep(.n-radio-button:not(.n-radio-button--checked)) {
      border-color: var(--n-button-border-color);
    }

    // 中文字形在 line-height: normal 下墨迹比行盒偏下约 0.5px，
    // 视觉上「上方留白偏大」；这里把文字上移半个像素补偿，让胶囊里真正居中。
    :deep(.n-radio__label) {
      transform: translateY(-0.5px);
    }
  }
}
</style>
