import { computed, ref } from "vue";
import { builtinSearchEnabled, mcpService, setBuiltinSearchEnabled } from "@/services/mcpService";
import type { McpServerConfig, McpToolInfo } from "@/types";

/**
 * MCP 外部工具管理：server 配置 CRUD 与工具发现。
 *
 * 外部工具一律要审批才执行，配置页只负责让作者填「怎么启动 server」；
 * 工具清单由后端 spawn 进程发现，发现失败不阻塞页面，只给可见提示。
 */

/** 新建表单的空白草稿；args 用换行输入，提交时再拆成数组。 */
export interface McpServerDraft {
  id: string;
  name: string;
  command: string;
  argsText: string;
  enabled: boolean;
}

export function emptyDraft(): McpServerDraft {
  return { id: "", name: "", command: "", argsText: "", enabled: true };
}

/** 从已有配置回填草稿；编辑时 id 只读，避免改 id 后变成新建。 */
export function toDraft(server: McpServerConfig): McpServerDraft {
  return {
    id: server.id,
    name: server.name,
    command: server.command,
    argsText: server.args.join("\n"),
    enabled: server.enabled,
  };
}

/** 把草稿转成后端入参；id 省略时由后端生成（这里用命令名+时间戳，避免依赖后端生成逻辑）。 */
export function toConfig(draft: McpServerDraft): McpServerConfig {
  return {
    id:
      draft.id.trim() || `srv-${draft.command.trim().replace(/[^a-zA-Z0-9_-]/g, "")}-${Date.now()}`,
    name: draft.name.trim() || draft.command.trim(),
    command: draft.command.trim(),
    args: draft.argsText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    enabled: draft.enabled,
  };
}

export function useMcpServers() {
  const servers = ref<McpServerConfig[]>([]);
  const tools = ref<McpToolInfo[]>([]);
  const loading = ref(false);
  const discovering = ref(false);
  const saving = ref(false);
  const error = ref("");
  /** 内置联网搜索默认开启；作者可以在这里关掉，关掉后 Agent 工具清单同步移除。 */
  const builtinEnabled = ref(true);
  const isEmpty = computed(() => servers.value.length === 0);

  /** 加载配置与已有工具缓存；工具发现较慢，由作者点「刷新工具」显式触发。 */
  async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      servers.value = await mcpService.listServers();
      builtinEnabled.value = await builtinSearchEnabled();
      tools.value = await mcpService.discoverTools();
    } catch (err) {
      error.value = `读取 MCP 配置失败：${String(err)}`;
    } finally {
      loading.value = false;
    }
  }

  /** 显式重新发现工具：server 刚刚配好时才有意义。 */
  async function refreshTools(): Promise<void> {
    discovering.value = true;
    error.value = "";
    try {
      // 作者显式点刷新：绕过缓存重新 spawn，否则「刷新」按钮只是读旧结果。
      tools.value = await mcpService.discoverTools(true);
      if (tools.value.length === 0 && servers.value.some((item) => item.enabled)) {
        error.value = "没有发现可用工具：请检查 server 命令是否可执行、是否已启用。";
      }
    } catch (err) {
      error.value = `发现工具失败：${String(err)}`;
    } finally {
      discovering.value = false;
    }
  }

  /** 保存配置；成功才关弹窗，失败保留草稿。 */
  async function save(draft: McpServerDraft): Promise<boolean> {
    saving.value = true;
    error.value = "";
    try {
      if (!draft.command.trim()) {
        error.value = "启动命令不能为空";
        return false;
      }
      servers.value = await mcpService.saveServer(toConfig(draft));
      return true;
    } catch (err) {
      error.value = `保存 MCP server 失败：${String(err)}`;
      return false;
    } finally {
      saving.value = false;
    }
  }

  async function remove(id: string): Promise<void> {
    error.value = "";
    try {
      servers.value = await mcpService.removeServer(id);
      tools.value = tools.value.filter((item) => item.serverId !== id);
    } catch (err) {
      error.value = `删除 MCP server 失败：${String(err)}`;
    }
  }

  /** 切换内置联网搜索；先写后端再同步工具清单，关闭时本地缓存也一起失效。 */
  async function toggleBuiltin(enabled: boolean): Promise<void> {
    error.value = "";
    try {
      builtinEnabled.value = await setBuiltinSearchEnabled(enabled);
      tools.value = await mcpService.discoverTools(true);
    } catch (err) {
      error.value = `切换内置联网搜索失败：${String(err)}`;
    }
  }

  return {
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
  };
}
