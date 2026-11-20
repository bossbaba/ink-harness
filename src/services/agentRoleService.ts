import { tauriApi } from "@/api/tauri";
import type { AgentRole, NewAgentRole, ToolDefinition } from "@/types";

/**
 * Agent 角色门面：页面与 composable 不直接调 IPC。
 *
 * 角色只回答「用什么身份说话、允许调哪些工具」，选模型仍走任务路由，
 * 因此换模型不需要动角色配置，换角色也不会把请求路由到别的 Provider。
 */
export const agentRoleService = {
  list: (): Promise<AgentRole[]> => tauriApi.listAgentRoles(),
  save: (input: NewAgentRole): Promise<AgentRole> => tauriApi.saveAgentRole(input),
  remove: (id: string): Promise<void> => tauriApi.deleteAgentRole(id),
};

/**
 * 解析角色的工具白名单。
 * 空串/非法 JSON 一律当成「全部工具」：老角色没配过工具时不该被锁死，
 * 新增工具也应该对它们自动生效。
 */
export function parseRoleTools(role: AgentRole | null | undefined): string[] {
  // 分开写两个判断：合成 `!role || !role.tools` 会被 lint 要求改成可选链，
  // 而可选链又无法让 TypeScript 在下面安全地访问 role.tools。
  if (!role) return [];
  if (!role.tools.trim()) return [];
  try {
    const value: unknown = JSON.parse(role.tools);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/** 按白名单过滤工具定义；白名单为空表示全部放行。 */
export function filterToolDefinitions(tools: ToolDefinition[], names: string[]): ToolDefinition[] {
  if (names.length === 0) return tools;
  const allowed = new Set(names);
  return tools.filter((tool) => allowed.has(tool.function.name));
}
