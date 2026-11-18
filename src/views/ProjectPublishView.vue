<script setup lang="ts">
import { NRadioButton, NRadioGroup } from "naive-ui";
import { computed, onMounted, ref } from "vue";
import BriefPanel from "@/components/publish/BriefPanel.vue";
import ExportPanel from "@/components/publish/ExportPanel.vue";
import PlatformPanel from "@/components/publish/PlatformPanel.vue";
import PublishPreview from "@/components/publish/PublishPreview.vue";
import { useProjectPublish } from "@/composables/useProjectPublish";
import { projectService } from "@/services/projectService";
import type { PublicationBrief, PublishTemplate } from "@/types";
import { onReactivated } from "@/utils/lifecycle";

type Tab = "preview" | "export" | "brief" | "platform";

/** 出版中心：同一份正文先排版预览，再导出、生成物料、安排发布，四步共用一套数据。 */
const props = defineProps<{
  projectId: string;
}>();

const {
  doc,
  loading,
  loadError,
  author,
  template,
  format,
  exporting,
  exportNotice,
  lastExport,
  brief,
  briefRaw,
  briefGenerating,
  briefReceived,
  briefError,
  plan,
  previewHtml,
  previewMarkdown,
  readyCount,
  load,
  setAuthor,
  exportFile,
  printPdf,
  generateBrief,
  copyBrief,
  togglePlatform,
  setEntry,
} = useProjectPublish(props.projectId);

const tab = ref<Tab>("preview");
const pageTitle = ref("出版中心");
const tabs: Array<{ key: Tab; label: string }> = [
  { key: "preview", label: "排版预览" },
  { key: "export", label: "导出" },
  { key: "brief", label: "发布物料" },
  { key: "platform", label: "发布清单" },
];

const hint = computed(() =>
  tab.value === "preview"
    ? "选一种版式看看正文排出来是什么样，切换模板不会改动原稿。"
    : tab.value === "export"
      ? "文件在本机生成，保存位置由系统对话框决定；正文不会上传。"
      : tab.value === "brief"
        ? "物料是草稿，逐项改好再复制到投稿平台。"
        : "勾选要投的平台，把排期和注意事项记在一起。",
);

onMounted(async () => {
  await load();
  const project = await projectService.get(props.projectId);
  if (project) pageTitle.value = `《${project.title}》· 出版中心`;
});

// 从别的页面（如写作台改了正文）回来时重读，预览与导出才不会用旧稿。
onReactivated(() => void load());

function copyMarkdown(): void {
  void navigator.clipboard.writeText(previewMarkdown.value);
}

function updateBrief(field: keyof PublicationBrief, value: string | string[]): void {
  if (!brief.value) return;
  brief.value = { ...brief.value, [field]: value } as PublicationBrief;
}
</script>

<template>
  <div class="publish">
    <header class="publish__header">
      <h1 class="publish__title serif">{{ pageTitle }}</h1>
      <p class="publish__subtitle">{{ hint }}</p>
    </header>

    <p v-if="loadError" class="publish__error">{{ loadError }}</p>

    <NRadioGroup :value="tab" size="small" @update:value="(value: Tab) => (tab = value)">
      <NRadioButton v-for="item in tabs" :key="item.key" :value="item.key">
        {{ item.label }}
      </NRadioButton>
    </NRadioGroup>

    <section v-if="loading && !doc" class="publish__empty">正在读取作品与章节…</section>
    <template v-else-if="doc">
      <PublishPreview
        v-if="tab === 'preview'"
        :template="template"
        :html="previewHtml"
        :markdown="previewMarkdown"
        :ready-count="readyCount"
        :loading="loading"
        @update:template="(value: PublishTemplate) => (template = value)"
        @copy="copyMarkdown"
      />
      <ExportPanel
        v-else-if="tab === 'export'"
        :format="format"
        :template="template"
        :author="author"
        :exporting="exporting"
        :notice="exportNotice"
        :last-export="lastExport"
        @update:format="(value) => (format = value)"
        @update:author="setAuthor"
        @export="exportFile"
        @print="printPdf"
      />
      <BriefPanel
        v-else-if="tab === 'brief'"
        :brief="brief"
        :raw="briefRaw"
        :generating="briefGenerating"
        :received="briefReceived"
        :error="briefError"
        @generate="generateBrief"
        @copy="copyBrief"
        @update:field="updateBrief"
      />
      <PlatformPanel v-else :plan="plan" @toggle="togglePlatform" @entry="setEntry" />
    </template>
    <section v-else class="publish__empty">这部作品还没有正文，先去写作台写一点再来排版。</section>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.publish {
  max-width: 1000px;
  min-width: 0;
  margin: 0 auto;
  padding: t.$space-6;
  container-type: inline-size;

  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-4;
  }

  &__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  &__subtitle {
    margin: t.$space-2 0 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__error {
    margin: t.$space-3 0 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--error, #{t.$error});
  }

  &__empty {
    margin-top: t.$space-4;
    padding: t.$space-4;
    @include m.card-surface(var(--bg-surface));
    font-size: 12px;
    color: var(--text-faint, #{t.$ink-faint});
  }
}
</style>
