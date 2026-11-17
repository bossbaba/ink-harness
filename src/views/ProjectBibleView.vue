<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NSpace } from "naive-ui";
import StoryBibleList from "@/components/storyBible/StoryBibleList.vue";
import StoryElementCreateDialog from "@/components/storyBible/StoryElementCreateDialog.vue";
import StoryElementForm from "@/components/storyBible/StoryElementForm.vue";
import StoryInsightsPanel from "@/components/storyBible/StoryInsightsPanel.vue";
import { useStoryBible } from "@/composables/useStoryBible";

// 从路由拿到作品 ID，作品内设定库的 CRUD 与一致性检查全部委托给 useStoryBible。
// projectId 必填：composable 会在缺失时报错并停止取数，不会回退到全局数据。
const props = defineProps<{ projectId: string }>();

const {
  projectTitle,
  elements,
  filterKind,
  keyword,
  selectedId,
  createShow,
  createKind,
  createName,
  createSummary,
  issues,
  error,
  busy,
  draft,
  filterOptions,
  filteredElements,
  selected,
  targetOptions,
  selectElement,
  startNew,
  submitCreate,
  save,
  removeSelected,
  addRelation,
  removeRelation,
  relationTargetName,
  checkConsistency,
  focusIssue,
} = useStoryBible(props.projectId);
</script>

<template>
  <div class="project-bible">
    <header class="project-bible__header">
      <div>
        <h1 class="project-bible__title serif">
          {{ projectTitle ? `《${projectTitle}》· 设定库` : "作品设定库" }}
        </h1>
        <p class="project-bible__subtitle">
          仅管理当前作品的设定；全局汇总请从菜单「设定库」进入。
        </p>
      </div>
      <NSpace>
        <MacButton size="regular" :disabled="busy || !projectTitle" @click="checkConsistency">
          {{ busy ? "检查中…" : "一致性检查" }}
        </MacButton>
        <MacButton
          size="regular"
          variant="prominent"
          :disabled="busy || !projectTitle"
          @click="startNew"
        >
          新建设定
        </MacButton>
      </NSpace>
    </header>

    <p v-if="error" class="project-bible__error">{{ error }}</p>

    <div v-if="!projectTitle && !error" class="project-bible__empty">
      <p>正在载入作品设定库…</p>
    </div>

    <div v-else-if="projectTitle" class="bible-grid">
      <StoryBibleList
        v-model:filter-kind="filterKind"
        v-model:keyword="keyword"
        :filter-options="filterOptions"
        :elements="elements"
        :filtered-elements="filteredElements"
        :selected-id="selectedId"
        @select="selectElement"
      />

      <StoryElementForm
        v-model:draft="draft"
        :selected="selected"
        :project-id="projectId"
        :target-options="targetOptions"
        :relation-target-name="relationTargetName"
        :busy="busy"
        @save="save"
        @delete="removeSelected"
        @new="startNew"
        @add-relation="addRelation"
        @remove-relation="removeRelation"
      />

      <StoryInsightsPanel
        class="panel--graph"
        :elements="elements"
        :selected-id="selectedId"
        :issues="issues"
        @select="selectElement"
        @focus-issue="focusIssue"
      />

      <StoryElementCreateDialog
        v-model:show="createShow"
        v-model:kind="createKind"
        v-model:name="createName"
        v-model:summary="createSummary"
        :busy="busy"
        :error="error"
        @create="submitCreate"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;

.project-bible {
  max-width: 1500px;
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

  &__subtitle,
  &__error {
    margin: t.$space-2 0 0;
    font-size: 12px;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__error {
    color: var(--error, #{t.$error});
  }

  &__empty {
    margin-top: t.$space-6;
    padding: t.$space-8;
    text-align: center;
    border: 1px dashed var(--divider, #{t.$divider});
    border-radius: t.$radius-lg;
    color: var(--text-faint, #{t.$ink-faint});
    font-size: 13px;
  }
}

.bible-grid {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr) 300px;
  gap: t.$space-4;
  margin-top: t.$space-5;
  align-items: start;
  min-width: 0;

  @media (max-width: 1180px) {
    grid-template-columns: 230px minmax(0, 1fr);

    .panel--graph {
      grid-column: 1 / -1;
    }
  }

  @container (max-width: 1000px) {
    grid-template-columns: 230px minmax(0, 1fr);

    .panel--graph {
      grid-column: 1 / -1;
    }
  }

  @container (max-width: 620px) {
    grid-template-columns: minmax(0, 1fr);

    .panel--graph {
      grid-column: auto;
    }
  }
}

@container (max-width: 620px) {
  .project-bible__header {
    flex-direction: column;
  }
}
</style>
