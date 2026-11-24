import { tauriApi } from "@/api/tauri";
import type { AgentTool, McpServerConfig, McpToolInfo } from "@/types";

/**
 * MCP 外部工具门面：把后端发现的工具转成 Agent Loop 可下发的 AgentTool。
 *
 * 设计要点：
 * 1. 工具发现是「附赠能力」，失败不能挡住内置工具——缓存保持上一次成功的结果。
 * 2. 外部工具一律 risk="write"，必须作者审批后才执行：MCP server 是外部进程，
 *    我们无法保证它返回什么，也不能让它绕过写操作闸门（见 actionExecutor）。
 * 3. 工具名带 server 前缀（后端 qualified_name），避免不同 server 同名冲突。
 */

/** 最近一次成功发现的工具；进程通信较慢，不要在每次 tool list 时重复拉。 */
let cachedTools: McpToolInfo[] = [];
/** 并发的 discover 复用同一个请求，避免多个组件同时触发多次 spawn。 */
let discovering: Promise<McpToolInfo[]> | null = null;

/** 把 MCP 工具名转成完整限定名（与后端 resolve_refs 的前缀约定一致）。 */
export function mcpQualifiedName(tool: McpToolInfo): string {
  return `${tool.serverId}__${tool.name}`;
}

/** 把一个 MCP 工具描述转成 AgentTool；run 走 IPC 调后端。 */
export function toAgentTool(tool: McpToolInfo): AgentTool {
  const qualified = mcpQualifiedName(tool);
  return {
    name: qualified,
    description: `[MCP:${tool.serverId}] ${tool.description || tool.name}`,
    parameters: tool.inputSchema,
    // 外部进程不可信：一律走审批，作者看过参数和结果摘要才放行。
    risk: "write",
    run: (args) => tauriApi.callMcpTool(qualified, args),
  };
}

/**
 * 发现所有启用 MCP server 的工具，并缓存结果。
 *
 * 默认缓存优先：Agent 每轮问答前都会调一次，不该每次都 spawn 外部进程。
 * 配置变更会 clearMcpCache，配置页的「刷新工具」显式传 force=true 绕过缓存。
 * 失败时保留上次缓存；首次失败返回空数组，绝不抛给调用方。
 */
export async function discoverTools(force = false): Promise<McpToolInfo[]> {
  if (discovering) return discovering;
  // 只有上一次成功发现且有工具时才短路；首次失败（空缓存）要保留重试机会。
  if (!force && cachedTools.length > 0) return cachedTools;
  discovering = tauriApi
    .listMcpTools()
    .then((tools) => {
      cachedTools = tools;
      return tools;
    })
    .catch(() => cachedTools)
    .finally(() => {
      discovering = null;
    });
  return discovering;
}

/** 取当前缓存的 MCP 工具（同步，供注册表组装用）；未 discover 过返回空数组。 */
export function cachedMcpTools(): McpToolInfo[] {
  return cachedTools;
}

/** 清空缓存：保存/删除 server 配置后调用，下次 discover 重新拉。 */
export function clearMcpCache(): void {
  cachedTools = [];
}

export const mcpService = {
  listServers: (): Promise<McpServerConfig[]> => tauriApi.listMcpServers(),
  saveServer: (input: McpServerConfig): Promise<McpServerConfig[]> =>
    tauriApi.saveMcpServer(input).then((servers) => {
      clearMcpCache();
      return servers;
    }),
  removeServer: (id: string): Promise<McpServerConfig[]> =>
    tauriApi.removeMcpServer(id).then((servers) => {
      clearMcpCache();
      return servers;
    }),
  discoverTools,
};
