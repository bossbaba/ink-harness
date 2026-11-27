import { describe, expect, it } from "vitest";

import { buildFallbackRule, buildToolRule, parseFallbackCalls } from "@/services/agentLoopRules";

/** 内置联网搜索的提示词跟着实际下发的工具清单走，关掉后不留幽灵指引。 */
describe("联网搜索工具提示", () => {
  const definitions = [
    {
      type: "function" as const,
      function: {
        name: "builtin-web-search__web_search",
        description: "联网检索公开资料。",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  it("下发联网搜索时提示模型先查证外部事实", () => {
    expect(buildToolRule(definitions)).toContain("先用 builtin-web-search__web_search 联网核对");
    expect(buildFallbackRule(definitions)).toContain("用 builtin-web-search__web_search 联网检索");
  });

  it("未下发联网搜索时不出现该指引", () => {
    expect(buildToolRule([])).not.toContain("web_search");
    expect(buildFallbackRule([])).not.toContain("web_search");
  });

  it("提示词明确禁止正文里写伪 XML 工具标签", () => {
    expect(buildToolRule(definitions)).toContain("禁止在正文里写 <function=...>");
    expect(buildFallbackRule(definitions)).toContain("不要其它文字或 <function=...> 这类标签");
  });
});

/** 小模型把工具调用写成自造标签时，要能抠出来真正执行，而不是当乱码展示。 */
describe("parseFallbackCalls 容错", () => {
  it("识别 mimo 风格的 <function=名><parameter name=键>值 片段", () => {
    const raw = `<tool_call><function=read_chapter><parameter name=includeContent>true</parameter>
</tool_call><function_call>
<parameter name=get_project></function_call>
<function_call>
<function=builtin-web-search__web_search>
<parameter name=query>最近末小说 灵感 20年时间倒计时 写作 去AI味 质感</parameter>
<parameter name=limit>5</parameter>
</function>
</tool_call>`;
    const calls = parseFallbackCalls(raw);
    expect(calls.map((call) => call.name)).toEqual([
      "read_chapter",
      "builtin-web-search__web_search",
    ]);
    expect(calls[0].arguments).toEqual({ includeContent: true });
    expect(calls[1].arguments).toEqual({
      query: "最近末小说 灵感 20年时间倒计时 写作 去AI味 质感",
      limit: 5,
    });
  });

  it("正文里零散的标签不会被误判成工具调用", () => {
    expect(parseFallbackCalls("写一段 <parameter name=x> 说明")).toEqual([]);
  });
});
