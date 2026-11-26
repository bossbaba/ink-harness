<script setup lang="ts">
import { NStep, NSteps, NTag } from "naive-ui";
import { computed, onMounted } from "vue";
import LoadingState from "@/components/common/LoadingState.vue";
import WorkflowStageCard from "@/components/workflow/WorkflowStageCard.vue";
import { useProjectWorkflow } from "@/composables/useProjectWorkflow";
import type { WorkflowDecision, WorkflowStage, WorkflowState } from "@/types";
import { WORKFLOW_CHAPTER_STAGES, WORKFLOW_STAGES } from "@/types";
import { onReactivated } from "@/utils/lifecycle";

/**
 * 作品内 Agent 工作流：用垂直步骤条展示策划→写作→编辑→审稿→出版。
 * 每一步内嵌操作区，AI 产出候选后由作者审批，通过才落地并解锁下一步。
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

/** 工作流状态映射到步骤条状态；被打回/出错显示红点，待审批与生成中显示进行中。 */
function stepStatus(
  workflow: WorkflowState,
  stage: WorkflowStage,
): "finish" | "error" | "process" | "wait" {
  const item = workflow.stages[stage];
  if (item.status === "approved") return "finish";
  if (item.status === "rejected") return "error";
  if (item.status === "running" || item.status === "pending") return "process";
  return "wait";
}

function stepDescription(stage: WorkflowStage): string {
  const item = state.value?.stages[stage];
  const hint = WORKFLOW_STAGES.find((s) => s.key === stage)?.hint ?? "";
  return item?.model ? `${hint} · 模型：${item.model}` : hint;
}

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
      <NTag
        v-if="completedCount === WORKFLOW_STAGES.length"
        size="small"
        :bordered="false"
        type="success"
      >
        全流程已完成
      </NTag>
    </header>

    <LoadingState v-if="loading" variant="inline" text="正在载入工作流…" />
    <p v-else-if="loadError" class="workflow__status workflow__status--error">{{ loadError }}</p>
    <template v-else-if="state">
      <p v-if="error" class="workflow__status workflow__status--error">{{ error }}</p>
      <p v-if="notice" class="workflow__status workflow__status--notice">{{ notice }}</p>

      <NSteps vertical size="medium" class="workflow__steps">
        <NStep
          v-for="item in WORKFLOW_STAGES"
          :key="item.key"
          :title="item.label"
          :description="stepDescription(item.key)"
          :status="stepStatus(state, item.key)"
        >
          <WorkflowStageCard
            :state="state.stages[item.key]"
            :running="running === item.key"
            :any-running="running !== null"
            :received="received"
            :unlocked="isUnlocked(item.key)"
            :busy="busy"
            :chapter-id="
              WORKFLOW_CHAPTER_STAGES.includes(item.key) ? state.selectedChapterId : null
            "
            :chapter-options="chapterOptions"
            @run="runStage(item.key)"
            @select-chapter="pickChapter"
            @approve="(decision, note) => decide(item.key, decision, note)"
          />
        </NStep>
      </NSteps>

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
  // 设计稿内容区撑满可用宽度；仅在超宽屏上限封顶。
  max-width: 1600px;
  margin: 0 auto;
  padding: t.$space-6;

  &__header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: t.$space-4;
    margin-bottom: t.$space-5;
  }

  &__title {
    margin: 0 0 t.$space-2;
    // 设计稿 3:1007：工作流页标题 28px 衬线。
    font-size: 1.75rem;
  }

  &__sub,
  &__status,
  &__footer p {
    margin: 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__status {
    &--error {
      color: var(--error, #{t.$error});
    }

    &--notice {
      color: var(--accent, #{t.$accent});
    }
  }

  &__steps {
    margin-top: t.$space-2;
    width: 100%;

    // 步骤内容区撑满整行：选章、产物预览与审批按钮不被挤在左侧窄条里。
    :deep(.n-step) {
      width: 100%;
    }
    :deep(.n-step__content) {
      min-width: 0;
      width: 100%;
      padding-bottom: t.$space-4;
    }
    // 标题与描述用正常层级，避免整条流水线都是淡灰小字。
    :deep(.n-step__title) {
      font-size: 14px;
      font-weight: 600;
    }
    :deep(.n-step__description) {
      font-size: 12px;
      line-height: 1.6;
    }
  }

  &__footer {
    padding-top: t.$space-3;
    border-top: 1px solid var(--divider, #{t.$divider});
  }
}
</style>
