<script setup lang="ts">
import { NButton, NInput, NModal, NPopconfirm, NSwitch, NTag } from "naive-ui";
import { onMounted, ref } from "vue";
import AppEmpty from "@/components/common/AppEmpty.vue";
import LoadingState from "@/components/common/LoadingState.vue";
import PageHeader from "@/components/common/PageHeader.vue";
import {
  emptyDraft,
  type McpServerDraft,
  toDraft,
  useMcpServers,
} from "@/composables/useMcpServers";
import type { McpServerConfig } from "@/types";
import { MODAL_WIDTH, modalStyle } from "@/utils/modal";

/**
 * MCP 外部工具（全局页 /mcp-tools）：配置 stdio server，让 Agent 能调用外部能力。
 *
 * 安全约定：这里的工具一律要作者审批后才执行，配置页只回答「怎么启动 server」；
 * 工具清单由后端 spawn 进程发现，发现失败不影响内置工具。
 */
const {
  servers,
  tools,
  loading,
  discovering,
  saving,
  error,
  isEmpty,
  builtinEnabled,
  load,
  refreshTools,
  save,
  remove,
  toggleBuiltin,
} = useMcpServers();

const editing = ref(false);
const draft = ref<McpServerDraft>(emptyDraft());
/** 正在编辑的 server id；非空表示修改，空表示新建。 */
const editingId = ref("");

function openCreate(): void {
  editingId.value = "";
  draft.value = emptyDraft();
  editing.value = true;
}

function openEdit(server: McpServerConfig): void {
  editingId.value = server.id;
  draft.value = toDraft(server);
  editing.value = true;
}

async function submit(): Promise<void> {
  // 编辑时保留原 id：toConfig 只在 id 为空时生成新 id。
  if (await save(draft.value)) editing.value = false;
}

onMounted(() => void load());
</script>

<template>
  <div class="mcp">
    <PageHeader
      eyebrow="全局设置"
      title="MCP 外部工具"
      subtitle="内置联网搜索让写作时随时查资料；也可配置 stdio 服务扩展能力，外部工具会先经你审批。"
    >
      <template #actions>
        <NButton size="small" :loading="discovering" @click="refreshTools">刷新工具</NButton>
        <NButton size="small" type="primary" @click="openCreate">添加服务</NButton>
      </template>
    </PageHeader>

    <p v-if="error" class="mcp__error">{{ error }}</p>

    <!-- 内置联网搜索不占 server 配置：随应用默认启用，作者可在这里一键关掉。 -->
    <section class="mcp__card">
      <div class="mcp__head">
        <h2 class="mcp__section">默认工具</h2>
        <div class="mcp__toggle">
          <span class="mcp__hint">{{ builtinEnabled ? "已启用" : "已停用" }}</span>
          <NSwitch
            :value="builtinEnabled"
            size="small"
            @update:value="(enabled: boolean) => toggleBuiltin(enabled)"
          />
        </div>
      </div>
      <ul class="mcp__tools">
        <li class="mcp__tool">
          <NTag size="small" :bordered="false" type="success">默认</NTag>
          <span class="mcp__tool-name">web_search</span>
          <span class="mcp__tool-server">内置 · 免配置</span>
          <span class="mcp__tool-desc">
            写作时联网检索公开资料，核对事实、专有名词与背景；只读，无需审批。
          </span>
        </li>
      </ul>
    </section>

    <LoadingState v-if="loading" variant="inline" text="正在读取 MCP 配置…" />

    <section v-else class="mcp__card">
      <h2 class="mcp__section">已配置的服务</h2>
      <AppEmpty
        v-if="isEmpty"
        icon="models"
        title="还没有 MCP 服务"
        description="添加一个 stdio 工具服务（如 npx -y @modelcontextprotocol/server-filesystem），Agent 就能调用它的工具。"
        action-label="添加服务"
        @action="openCreate"
      />
      <ul v-else class="mcp__list">
        <li v-for="server in servers" :key="server.id" class="mcp__server">
          <div class="mcp__server-main">
            <span class="mcp__server-name">{{ server.name }}</span>
            <span class="mcp__server-command"
              >{{ server.command }} {{ server.args.join(" ") }}</span
            >
          </div>
          <NTag size="small" :bordered="false" :type="server.enabled ? 'success' : 'default'">
            {{ server.enabled ? "已启用" : "已停用" }}
          </NTag>
          <div class="mcp__server-actions">
            <NButton size="tiny" quaternary @click="openEdit(server)">编辑</NButton>
            <NPopconfirm @positive-click="remove(server.id)">
              <template #trigger>
                <NButton size="tiny" quaternary type="error">删除</NButton>
              </template>
              删除这个服务配置？已发现的工具也会一起移除。
            </NPopconfirm>
          </div>
        </li>
      </ul>
    </section>

    <section class="mcp__card">
      <div class="mcp__head">
        <h2 class="mcp__section">发现的工具</h2>
        <!-- 设计稿 3:706：工具数量用小胶囊收在标题右侧，不占整行说明的位置。 -->
        <NTag size="small" :bordered="false">{{ tools.length }} 个</NTag>
      </div>
      <p v-if="tools.length === 0" class="mcp__hint">
        还没有发现工具。配置服务后点「刷新工具」；外部工具默认都要审批。
      </p>
      <ul v-else class="mcp__tools">
        <li v-for="tool in tools" :key="`${tool.serverId}__${tool.name}`" class="mcp__tool">
          <NTag size="small" :bordered="false" :type="tool.builtin ? 'success' : 'warning'">
            {{ tool.builtin ? "默认" : "需审批" }}
          </NTag>
          <span class="mcp__tool-name">{{ tool.name }}</span>
          <span class="mcp__tool-server">{{ tool.serverId }}</span>
          <span class="mcp__tool-desc">{{ tool.description || "（无描述）" }}</span>
        </li>
      </ul>
    </section>

    <NModal
      v-model:show="editing"
      preset="card"
      :style="modalStyle(MODAL_WIDTH.md)"
      :title="editingId ? '编辑 MCP 服务' : '添加 MCP 服务'"
    >
      <div class="mcp__form">
        <label class="mcp__field">
          <span class="mcp__label">显示名</span>
          <NInput v-model:value="draft.name" size="small" placeholder="如：本地文件服务" />
        </label>
        <label class="mcp__field">
          <span class="mcp__label">启动命令</span>
          <NInput
            v-model:value="draft.command"
            size="small"
            placeholder="如：npx 或 /usr/local/bin/mcp-server"
          />
        </label>
        <label class="mcp__field">
          <span class="mcp__label">参数（每行一个）</span>
          <NInput
            v-model:value="draft.argsText"
            type="textarea"
            size="small"
            :autosize="{ minRows: 2, maxRows: 5 }"
            placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/notes"
          />
        </label>
        <p class="mcp__hint">外部工具一律走审批闸门；不确定来源的 server 请不要启用。</p>
      </div>
      <template #footer>
        <div class="mcp__footer">
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

.mcp {
  container-type: inline-size;
  // 设计稿内容区撑满可用宽度；仅在超宽屏上限封顶。
  max-width: 1600px;
  margin: 0 auto;
  padding: t.$space-6;

  &__error {
    margin: 0 0 t.$space-3;
    font-size: 12px;
    line-height: 1.7;
    color: var(--error, #{t.$error});
  }

  &__card {
    @include m.card-surface(var(--bg-surface));
    padding: t.$space-4;
    margin-bottom: t.$space-4;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: t.$space-2;
    margin-bottom: t.$space-3;
  }

  &__section {
    margin: 0 0 t.$space-3;
    font-size: 14px;
    font-weight: 600;
  }

  &__toggle {
    display: flex;
    align-items: center;
    gap: t.$space-2;
  }

  &__hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-faint, #{t.$ink-faint});
  }

  &__list,
  &__tools {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__server,
  &__tool {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: t.$space-2;
    min-width: 0;
    padding: t.$space-2 t.$space-3;
    background: var(--bg-sunken, #{t.$paper-sunken});
    border-radius: t.$radius-sm;
    font-size: 12px;
  }

  &__server-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 240px;
  }

  &__server-name,
  &__tool-name {
    color: var(--text-primary, #{t.$ink});
    font-weight: 600;
  }

  &__server-command,
  &__tool-server,
  &__tool-desc {
    min-width: 0;
    color: var(--text-faint, #{t.$ink-faint});
    @include m.ellipsis;
  }

  &__server-actions {
    display: flex;
    gap: t.$space-1;
  }

  &__tool-desc {
    flex: 1 1 200px;
  }

  &__form {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: t.$space-3;
  }

  &__field {
    display: flex;
    flex-direction: column;
    gap: t.$space-2;
    min-width: 0;
  }

  &__label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #{t.$ink});
  }

  &__footer {
    display: flex;
    justify-content: flex-end;
    gap: t.$space-2;
  }
}
</style>
