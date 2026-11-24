<script setup lang="ts">
import { NButton, NCheckbox, NCheckboxGroup, NInput, NModal, NPopconfirm, NTag } from "naive-ui";
import { onMounted, ref } from "vue";
import AppEmpty from "@/components/common/AppEmpty.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import PageHeader from "@/components/common/PageHeader.vue";
import RolePresetGrid from "@/components/roles/RolePresetGrid.vue";
import {
  type AgentRoleDraft,
  emptyRoleDraft,
  toRoleDraft,
  useAgentRoles,
} from "@/composables/useAgentRoles";
import { AGENT_ROLE_PRESETS, type AgentRolePreset } from "@/services/agentRolePresets";
import type { AgentRole } from "@/types";
import { MODAL_WIDTH, modalStyle } from "@/utils/modal";

/**
 * Agent 角色管理（一级路由 /agent-roles）。
 *
 * 角色只定义「身份 prompt + 可用工具」，不绑定具体模型；写作台切角色时
 * 只改变系统提示与下发的工具集，模型仍由任务路由决定。
 * 页面顶部给出一组预设模板，点「添加」即复制成普通角色，之后随作者编辑。
 */
const {
  roles,
  loading,
  saving,
  error,
  isEmpty,
  roleNames,
  toolOptions,
  load,
  save,
  addPreset,
  remove,
} = useAgentRoles();

const editing = ref(false);
const draft = ref<AgentRoleDraft>(emptyRoleDraft());
/** 正在添加的预设名：卡片按钮单独 loading，不牵动弹窗里的保存状态。 */
const addingName = ref("");

function openCreate(): void {
  draft.value = emptyRoleDraft();
  editing.value = true;
}

/** 添加预设：失败时错误已写进 composable 的 error，这里只负责复位 loading。 */
async function handleAddPreset(preset: AgentRolePreset): Promise<void> {
  addingName.value = preset.name;
  try {
    await addPreset(preset);
  } finally {
    addingName.value = "";
  }
}

function openEdit(role: AgentRole): void {
  draft.value = toRoleDraft(role);
  editing.value = true;
}

/** 保存成功才关弹窗：失败时保留用户输入，避免刚写的 prompt 白写。 */
async function submit(): Promise<void> {
  if (await save(draft.value)) editing.value = false;
}

/** 列表里展示的工具摘要：全部放开时不用罗列全部名字，长列表反而看不清重点。 */
function toolSummary(role: AgentRole): string {
  if (!role.tools.trim()) return "全部工具";
  const names = toRoleDraft(role).toolNames;
  return names.length ? `${names.length} 个工具` : "全部工具";
}

onMounted(() => void load());
</script>

<template>
  <div class="roles">
    <PageHeader
      eyebrow="全局设置"
      title="Agent 角色"
      subtitle="定义身份提示词与可用工具；换角色不换模型，随时可以在写作台切换。"
    >
      <template #actions>
        <NButton size="small" type="primary" @click="openCreate">新建角色</NButton>
      </template>
    </PageHeader>

    <p v-if="error" class="roles__error">{{ error }}</p>

    <RolePresetGrid
      class="roles__presets"
      :presets="AGENT_ROLE_PRESETS"
      :added-names="roleNames"
      :busy-name="addingName"
      @add="handleAddPreset"
    />

    <section class="roles__card">
      <LoadingState v-if="loading && roles.length === 0" variant="inline" text="正在读取角色…" />
      <AppEmpty
        v-else-if="isEmpty"
        icon="models"
        title="还没有角色"
        description="默认角色会开放全部工具。想让 AI 只做审稿或只做续写时，用上面的预设或自己新建一个收窄工具的角色。"
        action-label="新建角色"
        @action="openCreate"
      />

      <ul v-else class="roles__list">
        <li v-for="role in roles" :key="role.id" class="roles__row">
          <div class="roles__main">
            <div class="roles__title">
              <span class="roles__name">{{ role.name }}</span>
              <NTag size="small" :bordered="false">{{ toolSummary(role) }}</NTag>
            </div>
            <p class="roles__prompt">
              {{ role.prompt || "未填写身份提示词，将按默认 Copilot 纪律回答。" }}
            </p>
          </div>
          <div class="roles__actions">
            <NButton size="small" @click="openEdit(role)">编辑</NButton>
            <NPopconfirm
              positive-text="删除"
              negative-text="取消"
              @positive-click="remove(role.id)"
            >
              <template #trigger>
                <NButton size="small" type="error">删除</NButton>
              </template>
              删除后不影响历史会话与评测记录，但写作台要重新选角色。
            </NPopconfirm>
          </div>
        </li>
      </ul>
    </section>

    <!-- 分组表单用大档：字段 + 工具勾选列表放得下，又不至于横跨整屏。 -->
    <NModal
      v-model:show="editing"
      preset="card"
      :title="draft.id ? '编辑角色' : '新建角色'"
      :style="modalStyle(MODAL_WIDTH.lg)"
      :bordered="false"
    >
      <div class="roles__form">
        <label class="roles__field">
          <span class="roles__label">角色名称</span>
          <NInput v-model:value="draft.name" size="small" placeholder="例如：结构审稿人" />
        </label>

        <label class="roles__field">
          <span class="roles__label">身份提示词</span>
          <NInput
            v-model:value="draft.prompt"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 8 }"
            placeholder="例如：只挑结构硬伤，按严重程度排序，不要重写原文。"
          />
        </label>

        <div class="roles__field">
          <span class="roles__label">可用工具</span>
          <NCheckbox
            :checked="draft.allTools"
            @update:checked="(checked: boolean) => (draft.allTools = checked)"
          >
            允许全部工具（包含以后新增的）
          </NCheckbox>

          <NCheckboxGroup v-if="!draft.allTools" v-model:value="draft.toolNames">
            <div class="roles__tools">
              <label v-for="tool in toolOptions" :key="tool.name" class="roles__tool">
                <NCheckbox :value="tool.name" />
                <span class="roles__tool-name">{{ tool.name }}</span>
                <NTag
                  size="small"
                  :bordered="false"
                  :type="tool.risk === 'write' ? 'warning' : 'info'"
                >
                  {{ tool.risk === "write" ? "需审批" : "只读" }}
                </NTag>
                <span class="roles__tool-desc">{{ tool.description }}</span>
              </label>
            </div>
          </NCheckboxGroup>
        </div>
      </div>

      <template #footer>
        <div class="roles__footer">
          <NButton size="small" @click="editing = false">取消</NButton>
          <NButton size="small" type="primary" :loading="saving" @click="submit">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped lang="scss">
@use "../styles/tokens" as t;
@use "../styles/mixins" as m;

.roles {
  container-type: inline-size;
  max-width: 860px;
  margin: 0 auto;
  padding: t.$space-6;

  &__error {
    margin: 0 0 t.$space-3;
    font-size: 12px;
    color: var(--error, #{t.$error});
  }

  &__card {
    @include m.card-surface(var(--bg-surface));
    padding: t.$space-4;
  }

  // 预设区与「我的角色」之间留一档间距，视觉上先选模板、再管自己的角色。
  &__presets {
    margin-bottom: t.$space-4;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: t.$space-3;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__row {
    display: flex;
    align-items: flex-start;
    gap: t.$space-3;
    padding: t.$space-3;
    background: var(--bg-sunken, #{t.$paper-sunken});
    border-radius: t.$radius-md;
    min-width: 0;
  }

  &__main {
    flex: 1;
    min-width: 0;
  }

  &__title {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
  }

  &__name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
    // 角色名可能较长：允许省略，但不允许把右侧「N 个工具」标签挤出可视区。
    min-width: 0;
    @include m.ellipsis;
  }

  &__prompt {
    margin: t.$space-1 0 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--text-soft, #{t.$ink-soft});
    @include m.ellipsis;
  }

  &__actions {
    display: flex;
    gap: t.$space-2;
    flex-shrink: 0;
  }

  &__form {
    display: flex;
    flex-direction: column;
    gap: t.$space-3;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
  }

  &__label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__tools {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    max-height: 260px;
    overflow: auto;
    padding: t.$space-2;
    background: var(--bg-sunken, #{t.$paper-sunken});
    border-radius: t.$radius-md;
  }

  &__tool {
    display: flex;
    align-items: center;
    gap: t.$space-2;
    font-size: 12px;
    min-width: 0;
  }

  &__tool-name {
    flex-shrink: 0;
    font-family: t.$font-mono;
    color: var(--text-primary, #{t.$ink});
  }

  &__tool-desc {
    flex: 1;
    min-width: 0;
    color: var(--text-faint, #{t.$ink-faint});
    @include m.ellipsis;
  }

  &__footer {
    display: flex;
    justify-content: flex-end;
    gap: t.$space-2;
  }
}

@container (max-width: 620px) {
  .roles {
    padding: t.$space-4;

    &__row {
      flex-direction: column;
    }

    &__actions {
      align-self: flex-end;
    }
  }
}
</style>
