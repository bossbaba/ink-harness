<script setup lang="ts">
import { NDrawer, NDrawerContent } from "naive-ui";
import DraftVersionPanel from "@/components/writing/DraftVersionPanel.vue";
import type { DraftVersion, DraftVersionBrief } from "@/types";

/**
 * 版本快照抽屉：外壳与标题在这里，版本数据与恢复流程仍由写作台页面的
 * useWritingDesk 提供，这里只做转发，不自己取数。
 */
const show = defineModel<boolean>("show", { required: true });

defineProps<{
  versions: DraftVersionBrief[];
  loading: boolean;
  snapshotBusy: boolean;
  restoreBusy: boolean;
  previewBusy: boolean;
  preview: DraftVersion | null;
}>();

const emit = defineEmits<{
  (event: "snapshot"): void;
  (event: "preview", versionId: string): void;
  (event: "restore", versionId: string): void;
  (event: "close-preview"): void;
}>();
</script>

<template>
  <NDrawer v-model:show="show" :width="320" placement="right">
    <NDrawerContent title="版本快照" closable>
      <DraftVersionPanel
        :versions="versions"
        :loading="loading"
        :snapshot-busy="snapshotBusy"
        :restore-busy="restoreBusy"
        :preview-busy="previewBusy"
        :preview="preview"
        @snapshot="emit('snapshot')"
        @preview="emit('preview', $event)"
        @restore="emit('restore', $event)"
        @close-preview="emit('close-preview')"
      />
    </NDrawerContent>
  </NDrawer>
</template>
