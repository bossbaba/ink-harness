import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MCP 前端门面单测：锁定「外部工具一律需审批」「发现失败不阻塞」两条安全契约。
 * tauriApi 全部 mock，测试不依赖真实后端与 stdio server。
 */
const { listMcpTools, callMcpTool, listMcpServers, saveMcpServer, removeMcpServer } = vi.hoisted(
  () => ({
    listMcpTools: vi.fn(),
    callMcpTool: vi.fn(),
    listMcpServers: vi.fn(),
    saveMcpServer: vi.fn(),
    removeMcpServer: vi.fn(),
  }),
);

vi.mock("@/api/tauri", () => ({
  tauriApi: { listMcpTools, callMcpTool, listMcpServers, saveMcpServer, removeMcpServer },
}));

import {
  cachedMcpTools,
  clearMcpCache,
  discoverTools,
  mcpQualifiedName,
  toAgentTool,
} from "@/services/mcpService";
import type { McpToolInfo } from "@/types";

const tool: McpToolInfo = {
  serverId: "srv-fs",
  name: "read_file",
  description: "读取文件",
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
};

describe("mcpQualifiedName / toAgentTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("工具名带 server 前缀，避免不同服务同名冲突", () => {
    expect(mcpQualifiedName(tool)).toBe("srv-fs__read_file");
  });

  it("MCP 工具转成 AgentTool 时一律标记为 write，必须走审批", () => {
    const agentTool = toAgentTool(tool);
    expect(agentTool).toMatchObject({
      name: "srv-fs__read_file",
      description: "[MCP:srv-fs] 读取文件",
      risk: "write",
      parameters: tool.inputSchema,
    });
  });

  it("run 用限定名调 IPC，参数原样透传", async () => {
    callMcpTool.mockResolvedValue("ok");
    const agentTool = toAgentTool(tool);
    await expect(agentTool.run({ path: "a.md" })).resolves.toBe("ok");
    expect(callMcpTool).toHaveBeenCalledWith("srv-fs__read_file", { path: "a.md" });
  });
});

describe("discoverTools 缓存", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMcpCache();
  });

  it("发现成功写缓存，重复调用复用缓存不重复 spawn", async () => {
    listMcpTools.mockResolvedValue([tool]);
    await expect(discoverTools()).resolves.toEqual([tool]);
    expect(cachedMcpTools()).toEqual([tool]);
    await discoverTools();
    expect(listMcpTools).toHaveBeenCalledTimes(1);
  });

  it("并发调用复用同一个请求，只拉一次", async () => {
    listMcpTools.mockResolvedValue([tool]);
    await Promise.all([discoverTools(), discoverTools(), discoverTools()]);
    expect(listMcpTools).toHaveBeenCalledTimes(1);
  });

  it("首次失败返回空数组，不把错误抛给调用方", async () => {
    listMcpTools.mockRejectedValue(new Error("server 挂了"));
    await expect(discoverTools()).resolves.toEqual([]);
  });

  it("强制刷新绕过缓存，重新 spawn 外部进程", async () => {
    listMcpTools.mockResolvedValue([tool]);
    await discoverTools();
    await discoverTools(true);
    expect(listMcpTools).toHaveBeenCalledTimes(2);
  });

  it("强制刷新失败保留上次成功缓存，内置工具照常工作", async () => {
    listMcpTools.mockResolvedValueOnce([tool]).mockRejectedValueOnce(new Error("超时"));
    await discoverTools();
    await expect(discoverTools(true)).resolves.toEqual([tool]);
    expect(cachedMcpTools()).toEqual([tool]);
  });

  it("清缓存后下次 discover 重新拉取", async () => {
    listMcpTools.mockResolvedValue([tool]);
    await discoverTools();
    clearMcpCache();
    expect(cachedMcpTools()).toEqual([]);
    await discoverTools();
    expect(listMcpTools).toHaveBeenCalledTimes(2);
  });
});
