<script setup lang="ts">
import { NTag } from "naive-ui";
import { computed } from "vue";
import type { SaveState } from "@/composables/useWritingDesk";
import { formatDateTime } from "@/utils/text";

// 保存状态与 NTag 语义色一一对应，避免散落的颜色判断漏掉某个状态。
type TagType = "default" | "success" | "warning" | "error" | "info";

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

// 配色与状态一一对应：未保存/保存中给 warning，失败给 error，已保存用默认弱色。
const tagType = computed<TagType>(() => {
  switch (props.state) {
    case "dirty":
    case "saving":
      return "warning";
    case "error":
      return "error";
    default:
      return "default";
  }
});
</script>

<template>
  <NTag v-if="label" size="small" :bordered="false" :type="tagType">{{ label }}</NTag>
</template>
