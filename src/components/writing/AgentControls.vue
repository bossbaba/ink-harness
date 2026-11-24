<script setup lang="ts">
import { NButton, NTag } from "naive-ui";
import { ref, watch } from "vue";
import type { AgentPanelState, AgentPlanStepStatus, PendingToolAction } from "@/types";

/**
 * AI 面板里的 Agent 结果区：写操作授权卡片 + 运行进度。
 *
 * 模式开关与角色选择已经挪到输入框下方（AgentBar）——那是「这次怎么问」；
 * 这里只留「上一轮发生了什么」，所以它跟着消息流走。
 * 组件纯展示：审批队列由 useWritingCopilot 持有。
 */
const props = defineProps<{
  agent: AgentPanelState;
}>();

/** 已完成的动作不占位置；失败留下来说明原因。 */
const visible = () => props.agent.actions.filter((item) => item.status !== "applied");

const STATUS_LABEL: Record<PendingToolAction["status"], string> = {
  pending: "待授权",
  approved: "已通过",
  rejected: "已驳回",
  applied: "已应用",
  failed: "失败",
};

/** 计划步骤的中文标签，和 Planner 回填给模型的叫法保持一致。 */
const PLAN_STATUS_LABEL: Record<AgentPlanStepStatus, string> = {
  pending: "待做",
  active: "进行中",
  done: "已完成",
  skipped: "已跳过",
};

/** 完成用成功色、进行中用信息色，其余保持中性，避免一屏彩色标签。 */
function planTagType(status: AgentPlanStepStatus): "default" | "info" | "success" {
  if (status === "done") return "success";
  if (status === "active") return "info";
  return "default";
}

// 通过/驳回共用一个 busyId：记录刚点的那个，让只有它转圈。
const pendingType = ref<"approve" | "reject" | null>(null);

watch(
  () => props.agent.busyId,
  (id) => {
    if (!id) pendingType.value = null;
  },
);

function act(type: "approve" | "reject", id: string): void {
  pendingType.value = type;
  void props.agent.onAction({ type, id });
}

/**
 * 从工具结果里取候选正文（propose_text 返回 JSON 文本），非 JSON 当纯文本。
 * 只对 propose_text 生效：apply_edits 等工具的结果是执行回执，不该被插进正文。
 */
function candidate(action: PendingToolAction): string {
  if (action.status !== "applied" || action.toolName !== "propose_text") return "";
  try {
    const value: unknown = JSON.parse(action.label);
    if (value && typeof value === "object" && "content" in value) {
      const content = (value as { content: unknown }).content;
      return typeof content === "string" ? content : action.label;
    }
  } catch {
    return action.label;
  }
  return action.label;
}
</script>

<template>
  <!-- 没有进度、计划、待审批动作时整块不渲染，避免消息流末尾常驻一个空盒子。 -->
  <section v-if="visible().length || agent.progress || agent.error || agent.plan" class="controls">
    <span v-if="agent.progress" class="controls__progress">{{ agent.progress }}</span>

    <div v-if="agent.plan" class="controls__plan">
      <div class="controls__plan-head">
        <span class="controls__plan-title">任务计划 v{{ agent.plan.version }}</span>
        <span v-if="agent.plan.reason" class="controls__plan-reason">
          已重规划：{{ agent.plan.reason }}
        </span>
      </div>
      <div v-for="step in agent.plan.steps" :key="step.id" class="controls__step">
        <NTag size="small" :bordered="false" :type="planTagType(step.status)">
          {{ PLAN_STATUS_LABEL[step.status] }}
        </NTag>
        <span class="controls__step-title" :title="step.intent">{{ step.title }}</span>
      </div>
    </div>

    <div v-for="action in visible()" :key="action.id" class="controls__action">
      <div class="controls__row">
        <NTag
          size="small"
          :bordered="false"
          :type="action.status === 'pending' ? 'warning' : 'default'"
        >
          {{ STATUS_LABEL[action.status] }}
        </NTag>
        <span class="controls__label">{{ action.label }}</span>
      </div>
      <!-- 逐条列出即将写入正文的改动：作者批准前能核对到具体文字，而不只是一句摘要。 -->
      <details v-if="action.preview?.items.length" class="controls__preview" open>
        <summary class="controls__preview-head">
          逐条改动（{{ action.preview.items.length }} 处）
          <span v-if="action.preview.target" class="controls__preview-target">
            {{ action.preview.target }}
          </span>
        </summary>
        <div class="controls__diff">
          <div v-for="item in action.preview.items" :key="item.id" class="controls__diff-item">
            <p class="controls__diff-line">
              <span class="controls__diff-tag">原文</span>
              <span class="controls__diff-quote">{{ item.quote }}</span>
            </p>
            <p class="controls__diff-line">
              <span class="controls__diff-tag">改为</span>
              <span class="controls__diff-replacement">{{ item.replacement }}</span>
            </p>
            <span v-if="item.truncated" class="controls__diff-truncated">
              显示已截断，完整内容仍会写入
            </span>
          </div>
        </div>
        <p v-if="action.preview.skipped" class="controls__diff-truncated">
          {{ action.preview.skipped }} 条格式不对的修改会被跳过
        </p>
      </details>
      <p v-if="action.error" class="controls__error">{{ action.error }}</p>
      <div class="controls__buttons">
        <template v-if="action.status === 'pending'">
          <NButton
            size="tiny"
            type="primary"
            :loading="agent.busyId === action.id && pendingType === 'approve'"
            :disabled="agent.busyId === action.id && pendingType !== 'approve'"
            @click="act('approve', action.id)"
            >通过</NButton
          >
          <NButton
            size="tiny"
            :loading="agent.busyId === action.id && pendingType === 'reject'"
            :disabled="agent.busyId === action.id && pendingType !== 'reject'"
            @click="act('reject', action.id)"
            >驳回</NButton
          >
        </template>
        <!-- approved 到 applied 之间可能要写库：给个明确的处理中提示，别让卡片看着卡住。 -->
        <span v-else-if="action.status === 'approved'" class="controls__busy">正在执行…</span>
        <NButton
          v-else-if="candidate(action)"
          size="tiny"
          quaternary
          @click="agent.onAction({ type: 'insert', text: candidate(action) })"
          >插入到正文</NButton
        >
      </div>
    </div>
    <button
      type="button"
      v-if="agent.actions.some((a) => a.status !== 'pending')"
      class="controls__clear"
      @click="agent.onAction({ type: 'clear' })"
    >
      清除记录
    </button>
    <p v-if="agent.error" class="controls__error">{{ agent.error }}</p>
  </section>
</template>

<style scoped lang="scss">
@use "../../styles/tokens" as t;
@use "../../styles/mixins" as m;

.controls {
  display: flex;
  flex-direction: column;
  gap: t.$space-2;
  margin: t.$space-2 0;
  padding: t.$space-3;
  border: 1px solid var(--divider, #{t.$divider});
  border-radius: t.$radius-md;
  min-width: 0;

  &__progress,
  &__clear,
  &__busy {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__plan {
    display: flex;
    flex-direction: column;
    gap: t.$space-1;
    min-width: 0;
  }

  &__plan-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
    min-width: 0;
  }

  &__plan-title {
    font-size: 12px;
    color: var(--text-primary, #{t.$ink});
  }

  &__plan-reason {
    min-width: 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
    @include m.ellipsis;
  }

  &__step {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
  }

  &__step-title {
    min-width: 0;
    font-size: 12px;
    color: var(--text-soft, #{t.$ink-soft});
    @include m.ellipsis;
  }

  &__clear {
    align-self: flex-end;
    background: none;
    border: none;
    cursor: pointer;
  }

  &__action {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    padding: t.$space-2;
    background: var(--bg-sunken, #{t.$paper-sunken});
    border-radius: t.$radius-sm;
    min-width: 0;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
  }

  &__label {
    font-size: 12px;
    color: var(--text-primary, #{t.$ink});
    @include m.ellipsis;
  }

  &__preview {
    min-width: 0;
    padding-top: t.$space-2;
    border-top: 1px solid var(--divider, #{t.$divider});
  }

  &__preview-head {
    font-size: 11px;
    color: var(--text-soft, #{t.$ink-soft});
    cursor: pointer;
  }

  &__preview-target {
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__diff {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    // 一次最多 50 条改动，限高内滚动，避免把整条消息流撑长。
    max-height: 200px;
    overflow: auto;
    margin-top: t.$space-2;
  }

  &__diff-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: t.$space-2;
    background: var(--bg-surface, #{t.$paper-raised});
    border-radius: t.$radius-sm;
  }

  &__diff-line {
    display: flex;
    align-items: flex-start;
    gap: t.$space-2;
    margin: 0;
    min-width: 0;
    font-size: 11px;
    line-height: 1.6;
  }

  &__diff-tag {
    flex-shrink: 0;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__diff-quote {
    min-width: 0;
    color: var(--text-faint, #{t.$ink-faint});
    text-decoration: line-through;
    word-break: break-word;
  }

  &__diff-replacement {
    min-width: 0;
    color: var(--accent, #{t.$accent});
    word-break: break-word;
  }

  &__diff-truncated {
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__error {
    margin: 0;
    font-size: 11px;
    color: var(--error, #{t.$error});
  }

  &__buttons {
    display: flex;
    gap: t.$space-2;
  }
}
</style>
