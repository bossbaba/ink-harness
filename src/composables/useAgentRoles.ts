import { computed, ref } from "vue";
import type { AgentRolePreset } from "@/services/agentRolePresets";
import { agentRoleService, parseRoleTools } from "@/services/agentRoleService";
import { AGENT_TOOLS } from "@/services/agentTools";
import { discoverTools, mcpQualifiedName } from "@/services/mcpService";
import type { AgentRole, McpToolInfo } from "@/types";

/** 角色编辑表单：把「全部工具」与「勾选白名单」两种状态收敛成一个布尔值。 */
export interface AgentRoleDraft {
  id: string;
  name: string;
  prompt: string;
  /** true 表示不限制工具（落库 tools 为空串）。 */
  allTools: boolean;
  toolNames: string[];
}

/** 工具清单：页面勾选框与描述都从这里取，新增工具自动出现在界面上。 */
export const AGENT_TOOL_OPTIONS = AGENT_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  risk: tool.risk,
}));

/** 空表单：默认放开全部工具，新建角色先能用，作者再按需收窄。 */
export function emptyRoleDraft(): AgentRoleDraft {
  return { id: "", name: "", prompt: "", allTools: true, toolNames: [] };
}

/** 把库里的角色转成表单；tools 为空串或解析失败都视为「全部工具」。 */
export function toRoleDraft(role: AgentRole): AgentRoleDraft {
  const names = parseRoleTools(role);
  return {
    id: role.id,
    name: role.name,
    prompt: role.prompt,
    allTools: names.length === 0,
    toolNames: names,
  };
}

/**
 * Agent 角色管理：列表、保存、删除。
 * 页面只负责渲染与表单，请求与错误处理都在这里，便于单测与复用。
 */
export function useAgentRoles() {
  const roles = ref<AgentRole[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref("");
  /** 已发现的 MCP 工具；进程通信较慢，仅在进入角色页时刷新一次。 */
  const mcpTools = ref<McpToolInfo[]>([]);

  const isEmpty = computed(() => !loading.value && roles.value.length === 0);

  /**
   * 工具白名单选项：内置工具 + MCP 工具。
   * MCP 工具名带 server 前缀（与后端限定名一致），且一律需审批，避免重名和越权。
   */
  const toolOptions = computed(() => [
    ...AGENT_TOOL_OPTIONS,
    ...mcpTools.value.map((tool) => ({
      name: mcpQualifiedName(tool),
      description: `[MCP:${tool.serverId}] ${tool.description || tool.name}`,
      risk: "write" as const,
    })),
  ]);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      roles.value = await agentRoleService.list();
    } catch (err) {
      error.value = `读取角色失败：${String(err)}`;
    } finally {
      loading.value = false;
    }
    // MCP 工具只用于填充白名单选项；发现失败不能影响角色列表本身。
    try {
      mcpTools.value = await discoverTools();
    } catch {
      mcpTools.value = [];
    }
  }

  /**
   * 保存角色：成功后就地更新列表，不重新拉全量——
   * 列表顺序按名称排，本地插入会错位，所以改成「更新已有 / 追加新增」后按名重排。
   */
  async function save(draft: AgentRoleDraft): Promise<boolean> {
    if (!draft.name.trim()) {
      error.value = "角色名称不能为空。";
      return false;
    }
    saving.value = true;
    error.value = "";
    try {
      const saved = await agentRoleService.save({
        id: draft.id || undefined,
        name: draft.name.trim(),
        prompt: draft.prompt.trim(),
        // 空串表示全部工具：新增工具时老角色自动获得权限，不用逐个补勾。
        tools: draft.allTools ? "" : JSON.stringify(draft.toolNames),
      });
      const exists = roles.value.some((item) => item.id === saved.id);
      roles.value = (
        exists
          ? roles.value.map((item) => (item.id === saved.id ? saved : item))
          : [...roles.value, saved]
      ).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      return true;
    } catch (err) {
      error.value = `保存角色失败：${String(err)}`;
      return false;
    } finally {
      saving.value = false;
    }
  }

  /** 删除角色：历史会话与评测保留 roleName 快照，这里只移除配置本身。 */
  async function remove(id: string): Promise<void> {
    error.value = "";
    try {
      await agentRoleService.remove(id);
      roles.value = roles.value.filter((item) => item.id !== id);
    } catch (err) {
      error.value = `删除角色失败：${String(err)}`;
    }
  }

  /** 已有角色的名称，预设卡片据此判断「已添加」，避免重复创建同名角色。 */
  const roleNames = computed(() => roles.value.map((item) => item.name));

  /**
   * 把一条预设模板复制成普通角色。
   *
   * 复制而不是引用模板：作者接下来会改措辞、增删工具，改的是自己那份，
   * 模板本身始终可再次添加。同名已存在时直接提示去编辑那一条，不做自动改名，
   * 否则列表里会堆出「结构审稿人 2」这种看不出区别的条目。
   */
  async function addPreset(preset: AgentRolePreset): Promise<boolean> {
    if (roles.value.some((item) => item.name === preset.name)) {
      error.value = `已有同名角色「${preset.name}」，直接编辑那一条即可。`;
      return false;
    }
    return save({
      id: "",
      name: preset.name,
      prompt: preset.prompt,
      allTools: preset.toolNames.length === 0,
      toolNames: [...preset.toolNames],
    });
  }

  return {
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
  };
}
