import { computed, ref } from "vue";
import { agentRoleService, parseRoleTools } from "@/services/agentRoleService";
import { AGENT_TOOLS } from "@/services/agentTools";
import type { AgentRole } from "@/types";

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

  const isEmpty = computed(() => !loading.value && roles.value.length === 0);

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

  return { roles, loading, saving, error, isEmpty, load, save, remove };
}
