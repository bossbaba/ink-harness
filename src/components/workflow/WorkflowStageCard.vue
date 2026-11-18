<script setup lang="ts">
import { MacButton } from "@macvue/core";
import { NButton, NInput, NSelect } from "naive-ui";
import { ref, watch } from "vue";
import type { WorkflowStageState } from "@/types";
import { WORKFLOW_DECISION_LABEL } from "@/types";

/**
 * 步骤条里单个阶段的操作区：选章、候选产物预览与人工审批。
 * 阶段标题/状态图标由外层 NSteps 负责，这里只放「做什么」，避免两处重复标题。
 */
const props = defineProps<{
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

function copyArtifact(): void {
  void navigator.clipboard.writeText(props.state.artifact);
}
</script>

<template>
  <div class="stage">
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
          <NButton size="tiny" quaternary @click="expanded = !expanded">
            {{ expanded ? "收起" : "展开" }}
          </NButton>
          <NButton size="tiny" quaternary @click="copyArtifact">复制</NButton>
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
      <MacButton size="regular" :disabled="running || busy || !unlocked" @click="emit('run')">
        {{ running ? `生成中… ${received} 字` : state.artifact ? "重新生成" : "运行本阶段" }}
      </MacButton>
      <span v-if="!unlocked" class="stage__locked">需先通过上一阶段</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.stage {
  display: flex;
  flex-direction: column;
  gap: t.$space-3;
  min-width: 0;
  width: 100%;
  padding: t.$space-4;
  @include m.card-surface(var(--bg-surface));

  &__chapter label {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    max-width: 560px;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__result {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    min-width: 0;
  }

  &__result-head,
  &__actions {
    display: flex;
    align-items: center;
    gap: t.$space-3;
  }

  &__result-head {
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
  }

  &__result-actions {
    display: flex;
    gap: t.$space-1;
  }

  &__artifact {
    max-height: 220px;
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

  &__error,
  &__decision,
  &__locked {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__error {
    padding: t.$space-2 t.$space-3;
    border-radius: t.$radius-md;
    background: var(--bg-sunken, #{t.$paper-sunken});
    color: var(--error, #{t.$error});
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
