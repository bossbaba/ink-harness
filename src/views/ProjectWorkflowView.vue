<script setup lang="ts">
import { computed, onMounted } from "vue";
import WorkflowStageCard from "@/components/workflow/WorkflowStageCard.vue";
import { useProjectWorkflow } from "@/composables/useProjectWorkflow";
import type { WorkflowDecision, WorkflowStage } from "@/types";
import { WORKFLOW_CHAPTER_STAGES, WORKFLOW_STAGES } from "@/types";
import { onReactivated } from "@/utils/lifecycle";

/**
 * 作品内 Agent 工作流：策划→写作→编辑→审稿→出版，每阶段人工审批后才落地。
 * 页面只负责组装：状态与副作用都在 useProjectWorkflow，卡片只做展示与转发。
 */
const props = defineProps<{ projectId: string }>();

const {
  project,
  chapters,
  state,
  loading,
  loadError,
  running,
  received,
  busy,
  error,
  notice,
  activeStage,
  isUnlocked,
  load,
  selectChapter,
  run,
  approve,
} = useProjectWorkflow(props.projectId);

const pageTitle = computed(() =>
  project.value ? `《${project.value.title}》· 创作工作流` : "创作工作流",
);

const chapterOptions = computed(() =>
  chapters.value.map((chapter) => ({
    label: `第${chapter.act}幕 · ${chapter.title}`,
    value: chapter.id,
  })),
);

const completedCount = computed(
  () =>
    WORKFLOW_STAGES.filter((item) => state.value?.stages[item.key].status === "approved").length,
);

function runStage(stage: WorkflowStage): void {
  void run(stage);
}

function decide(stage: WorkflowStage, decision: WorkflowDecision, note: string): void {
  void approve(stage, decision, note);
}

function pickChapter(id: string): void {
  void selectChapter(id);
}

onMounted(() => void load());
onReactivated(() => void load());
</script>

<template>
  <div class="workflow">
    <header class="workflow__header">
      <div>
        <h1 class="workflow__title serif">{{ pageTitle }}</h1>
        <p class="workflow__sub">
          流水线共五步，已完成 {{ completedCount }}/{{ WORKFLOW_STAGES.length }}。
          每一步先由 AI 产出候选，<strong>经你审批通过才会写入作品</strong>并解锁下一步。
        </p>
      </div>
      <div v-if="activeStage" class="workflow__current">
        当前阶段：{{ WORKFLOW_STAGES.find((s) => s.key === activeStage)?.label }}
      </div>
      <p v-else class="workflow__current workflow__current--done">全流程已完成</p>
    </header>

    <p v-if="loading" class="workflow__status">正在载入工作流…</p>
    <p v-else-if="loadError" class="workflow__status workflow__status--error">{{ loadError }}</p>
    <template v-else-if="state">
      <p v-if="error" class="workflow__status workflow__status--error">{{ error }}</p>
      <p v-if="notice" class="workflow__status workflow__status--notice">{{ notice }}</p>

      <div class="workflow__list">
        <WorkflowStageCard
          v-for="(item, index) in WORKFLOW_STAGES"
          :key="item.key"
          :index="index"
          :stage-key="item.key"
          :label="item.label"
          :hint="item.hint"
          :state="state.stages[item.key]"
          :running="running === item.key"
          :received="received"
          :unlocked="isUnlocked(item.key)"
          :busy="busy"
          :chapter-id="WORKFLOW_CHAPTER_STAGES.includes(item.key) ? state.selectedChapterId : null"
          :chapter-options="chapterOptions"
          @run="runStage(item.key)"
          @select-chapter="pickChapter"
          @approve="(decision, note) => decide(item.key, decision, note)"
        />
      </div>

      <footer class="workflow__footer">
        <p>工作流状态保存在本机；审批通过才会写入作品数据，生成结果不自动发布。</p>
      </footer>
    </template>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;

.workflow {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: t.$space-4;
  min-width: 0;
  padding: t.$space-6;

  &__header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-4;
  }

  &__title {
    margin: 0 0 t.$space-2;
    font-size: 1.5rem;
  }

  &__sub,
  &__current,
  &__status,
  &__chapters-hint,
  &__footer p {
    margin: 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__current {
    padding: t.$space-2 t.$space-3;
    border-radius: t.$radius-md;
    background: var(--bg-sunken, #{t.$paper-sunken});
    color: var(--text-soft, #{t.$ink-soft});

    &--done {
      color: var(--accent, #{t.$accent});
    }
  }

  &__status {
    &--error {
      color: var(--error, #{t.$error});
    }

    &--notice {
      color: var(--accent, #{t.$accent});
    }
  }

  &__list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
    gap: t.$space-4;
  }

  &__footer {
    padding-top: t.$space-3;
    border-top: 1px solid var(--divider, #{t.$divider});
  }

  @container (max-width: 1000px) {
    &__list {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}
</style>
