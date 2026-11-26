<script setup lang="ts">
import { NButton, NSpace } from "naive-ui";
import LoadingState from "@/components/common/LoadingState.vue";
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
  saving,
  creating,
  removing,
  checking,
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
        <NButton
          size="small"
          :loading="checking"
          :disabled="(busy && !checking) || !projectTitle"
          @click="checkConsistency"
        >
          一致性检查
        </NButton>
        <NButton size="small" type="primary" :disabled="busy || !projectTitle" @click="startNew">
          新建设定
        </NButton>
      </NSpace>
    </header>

    <p v-if="error" class="project-bible__error">{{ error }}</p>

    <LoadingState v-if="!projectTitle && !error" text="正在载入作品设定库…" />

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
        :saving="saving"
        :removing="removing"
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
        :creating="creating"
        :error="error"
        @create="submitCreate"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;

.project-bible {
  // 设计稿内容区撑满可用宽度；仅在超宽屏上限封顶。
  max-width: 1600px;
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
    // 设计稿 3:778：作品内页标题 26px 衬线。
    font-size: 1.625rem;
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
}

.bible-grid {
  display: grid;
  // 设计稿 3:786：列表 216px / 编辑面板弹性 / 关系图 258px，栏间 14px。
  grid-template-columns: 216px minmax(0, 1fr) 258px;
  gap: 14px;
  margin-top: t.$space-5;
  align-items: start;
  min-width: 0;

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
