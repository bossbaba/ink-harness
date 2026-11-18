<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NInput, NSelect, NTag } from "naive-ui";
import { ref, watch } from "vue";
import type { WorkflowStage, WorkflowStageState } from "@/types";
import { WORKFLOW_DECISION_LABEL, WORKFLOW_STATUS_LABEL } from "@/types";

/**
 * 工作流中的单个阶段卡片：展示状态、候选产物与审批操作。
 * 产物可展开查看、复制；审批决定必须作者显式点「通过/打回」，AI 不会自己推进流水线。
 */
const props = defineProps<{
  index: number;
  stageKey: WorkflowStage;
  label: string;
  hint: string;
  state: WorkflowStageState;
  running: boolean;
  received: number;
  unlocked: boolean;
  busy: boolean;
  /** 写作/编辑阶段需要选章时才传，其他阶段为 null。 */
  chapterId: string | null;
  /** 章节下拉选项；只有 chapterId 非 null 时使用。 */
  chapterOptions: Array<{ label: string; value: string }>;
}>();

const emit = defineEmits<{
  run: [];
  approve: [decision: "approved" | "rejected", note: string];
  "select-chapter": [id: string];
}>();

const expanded = ref(false);
const note = ref("");

watch(
  () => props.state.artifact,
  () => {
    note.value = "";
  },
);

const statusType = (): "default" | "info" | "warning" | "success" | "error" => {
  switch (props.state.status) {
    case "running":
      return "info";
    case "pending":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "error";
    default:
      return "default";
  }
};

function copyArtifact(): void {
  void navigator.clipboard.writeText(props.state.artifact);
}
</script>

<template>
  <section class="stage" :class="{ 'stage--active': unlocked && state.status !== 'approved' }">
    <header class="stage__head">
      <div class="stage__title">
        <span class="stage__index">{{ index + 1 }}</span>
        <div>
          <h2 class="stage__label">{{ label }}</h2>
          <p class="stage__hint">{{ hint }}</p>
        </div>
      </div>
      <NTag size="small" :bordered="false" :type="statusType()">
        {{ running ? `生成中 ${received} 字` : WORKFLOW_STATUS_LABEL[state.status] }}
      </NTag>
    </header>

    <div v-if="chapterId !== null" class="stage__chapter">
      <label>
        <span>目标章节</span>
        <NSelect
          :value="chapterId || null"
          :options="chapterOptions"
          size="small"
          placeholder="请选择要处理的章节（先到「大纲」创建）"
          @update:value="(value: string | null) => emit('select-chapter', value ?? '')"
        />
      </label>
    </div>

    <div v-if="state.artifact" class="stage__result">
      <div class="stage__result-head">
        <span>候选产物（{{ state.artifact.length }} 字）</span>
        <div class="stage__result-actions">
          <button type="button" @click="expanded = !expanded">
            {{ expanded ? "收起" : "展开" }}
          </button>
          <button type="button" @click="copyArtifact">复制</button>
        </div>
      </div>
      <pre v-if="expanded" class="stage__artifact">{{ state.artifact }}</pre>
    </div>

    <p v-if="state.error" class="stage__error">{{ state.error }}</p>
    <p v-if="state.decision" class="stage__decision">
      {{ WORKFLOW_DECISION_LABEL[state.decision] }} ·
      {{ state.decidedAt.slice(0, 16).replace("T", " ") }}
      <span v-if="state.note">：{{ state.note }}</span>
    </p>

    <div v-if="state.status === 'pending'" class="stage__approve">
      <NInput
        v-model:value="note"
        size="small"
        type="textarea"
        :autosize="{ minRows: 1, maxRows: 3 }"
        placeholder="审批备注（打回时建议写明原因）"
      />
      <div class="stage__actions">
        <MacButton
          size="regular"
          variant="prominent"
          :disabled="busy"
          @click="emit('approve', 'approved', note)"
        >
          通过并落地
        </MacButton>
        <MacButton size="regular" :disabled="busy" @click="emit('approve', 'rejected', note)">
          打回重做
        </MacButton>
      </div>
    </div>

    <div v-else class="stage__actions">
      <MacButton
        size="regular"
        :disabled="running !== null || busy || !unlocked"
        @click="emit('run')"
      >
        {{ running ? "生成中…" : state.artifact ? "重新生成" : "运行本阶段" }}
      </MacButton>
      <span v-if="!unlocked" class="stage__locked">需先通过上一阶段</span>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;

.stage {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  min-width: 0;
  padding: t.$space-4;
  border: 1px solid var(--divider, #{t.$divider});
  border-radius: t.$radius-lg;
  background: var(--bg-surface, #{t.$paper-raised});
  box-shadow: t.$shadow-card;

  &--active {
    border-color: var(--accent, #{t.$accent});
  }

  &__head,
  &__title,
  &__result-head,
  &__actions {
    display: flex;
    align-items: center;
    gap: t.$space-3;
  }

  &__head {
    justify-content: space-between;
  }

  &__title {
    min-width: 0;
  }

  &__index {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--bg-sunken, #{t.$paper-sunken});
    color: var(--text-primary, #{t.$ink});
    font-size: 13px;
  }

  &__label {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  &__hint,
  &__locked,
  &__decision,
  &__error {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__error {
    color: var(--error, #{t.$error});
  }

  &__chapter label {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__result {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    min-width: 0;
  }

  &__result-head {
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__result-actions {
    display: flex;
    gap: t.$space-3;

    button {
      padding: 0;
      border: 0;
      background: none;
      color: var(--accent, #{t.$accent});
      font-size: 11px;
      cursor: pointer;
    }
  }

  &__artifact {
    max-height: 240px;
    margin: 0;
    padding: t.$space-3;
    overflow: auto;
    border-radius: t.$radius-md;
    background: var(--bg-sunken, #{t.$paper-sunken});
    font-size: 12px;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
  }

  &__approve {
    display: flex;
    flex-direction: column;
    gap: t.$space-3;
  }

  &__actions {
    flex-wrap: wrap;
  }
}
</style>
