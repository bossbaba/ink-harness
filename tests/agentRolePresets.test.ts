import { describe, expect, it } from "vitest";
import { AGENT_ROLE_PRESETS } from "@/services/agentRolePresets";
import { AGENT_TOOLS } from "@/services/agentTools";

/**
 * 预设角色的单测守两件事：
 * 1. 工具名必须真的存在于注册表——白名单写错会让模型一个工具都拿不到，界面上却看不出异常；
 * 2. key 与名称不重复，否则列表 v-for 的 key 冲突、卡片「已添加」判断也会误伤。
 */
describe("AGENT_ROLE_PRESETS", () => {
  const toolNames = new Set(AGENT_TOOLS.map((tool) => tool.name));

  it("所有预设引用的工具都真实注册过", () => {
    for (const preset of AGENT_ROLE_PRESETS) {
      for (const name of preset.toolNames) {
        expect(toolNames.has(name), `${preset.name} 引用了不存在的工具 ${name}`).toBe(true);
      }
    }
  });

  it("key 与名称都唯一，且提示词不为空", () => {
    const keys = AGENT_ROLE_PRESETS.map((preset) => preset.key);
    const names = AGENT_ROLE_PRESETS.map((preset) => preset.name);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
    for (const preset of AGENT_ROLE_PRESETS) {
      expect(preset.prompt.trim().length).toBeGreaterThan(0);
      expect(preset.summary.trim().length).toBeGreaterThan(0);
    }
  });

  it("预设都收窄了工具白名单，不直接放开全部工具", () => {
    // 放开全部工具等于没角色，预设的价值就在于「只做一类事」。
    for (const preset of AGENT_ROLE_PRESETS) {
      expect(preset.toolNames.length, `${preset.name} 没有限定工具`).toBeGreaterThan(0);
    }
  });

  it("去AI味编辑只提交候选文本，不直接落库改正文", () => {
    // 这个预设的用途是改写，误开 apply_edits 会绕过作者审批把替换写进章节。
    const preset = AGENT_ROLE_PRESETS.find((item) => item.key === "ai-flavor-remover");
    expect(preset).toBeDefined();
    expect(preset?.toolNames).toContain("propose_text");
    expect(preset?.toolNames).not.toContain("apply_edits");
  });
});
