/** MCP（Model Context Protocol）外部工具相关类型。 */

/**
 * 一个 MCP server 的启动配置，存 app_meta 里的 JSON 数组。
 * 不存密钥：需要鉴权的 server 用环境变量占位，由部署者自己注入。
 */
export interface McpServerConfig {
  id: string;
  name: string;
  /** 启动命令（npx / uvx / 绝对路径）。 */
  command: string;
  /** 命令行参数。 */
  args: string[];
  enabled: boolean;
}

/** tools/list 发现出的一个外部工具。 */
export interface McpToolInfo {
  serverId: string;
  name: string;
  description: string;
  /** 标准 JSON Schema；MCP 的 inputSchema 原样透传。 */
  inputSchema: Record<string, unknown>;
  /**
   * 应用自带的默认工具（联网搜索）：只读、无需审批。
   * 第三方 server 即便自称 builtin 也会被后端强制置为 false。
   */
  builtin?: boolean;
}
