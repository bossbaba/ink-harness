<script setup lang="ts">
import { computed } from "vue";
import type { SaveState } from "@/composables/useWritingDesk";
import { formatDateTime } from "@/utils/text";

/**
 * 标题栏里的保存状态：未保存 / 保存中 / 已保存 + 时间 / 保存失败。
 *
 * 抽出来是因为文案与配色需要一一对应，散在页面里改颜色容易漏掉某个状态；
 * idle（还没载入正文）不渲染任何东西。
 */
const props = defineProps<{
  state: SaveState;
  /** 上次成功保存的时间；为空时只显示「已保存」。 */
  savedAt: string;
}>();

const label = computed(() => {
  switch (props.state) {
    case "dirty":
      return "未保存…";
    case "saving":
      return "保存中…";
    case "saved":
      return props.savedAt ? `已保存 ${formatDateTime(props.savedAt)}` : "已保存";
    case "error":
      return "保存失败";
    default:
      return "";
  }
});
</script>

<template>
  <span v-if="label" class="save" :class="`save--${state}`">{{ label }}</span>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;

.save {
  &--saving,
  &--dirty {
    color: var(--warning, #{t.$warning});
  }

  &--error {
    color: var(--error, #{t.$error});
  }

  &--saved {
    color: var(--text-faint, #{t.$ink-faint});
  }
}
</style>
