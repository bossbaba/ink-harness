import { describe, expect, it } from "vitest";

import { MASK, scrubArgs, scrubText } from "@/services/guardrails";

/**
 * 前端脱敏单测：规则要与 Rust 侧 guardrails.rs 保持一致。
 * 关键取舍是只拦凭据特征，不碰手机号/身份证/邮箱——小说正文里出现这些是正常情节。
 */
describe("scrubText", () => {
  it("屏蔽常见 API key 前缀的凭据", () => {
    expect(scrubText("密钥 sk-abcdefghijklmnopqrstu 已配置")).toContain(MASK);
    // 只替换凭据主体，外围的说明文字保留，作者才能看出是哪一项被屏蔽。
    expect(scrubText("token ghp_abcdefghijklmnopqrstuvwxyz1234")).toBe(`token ${MASK}`);
    expect(scrubText("key AKIAABCDEFGHIJKLMNOP")).toBe(`key ${MASK}`);
  });

  it("短于阈值的前缀当普通文本，不误伤正文", () => {
    expect(scrubText("他说 sk-short 就走了")).toBe("他说 sk-short 就走了");
  });

  it("屏蔽 Bearer 令牌与 PEM 私钥块", () => {
    expect(scrubText("Authorization: Bearer abcdefghijklmnop")).toContain(MASK);
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----";
    expect(scrubText(pem)).toBe(MASK);
  });

  it("Bearer 匹配大小写不敏感且保留原文前缀写法", () => {
    const masked = scrubText("headers: bearer abcdefghijklmnop and BEARER qwertyuiopasdfgh");
    expect(masked).not.toContain("abcdefghijklmnop");
    expect(masked).not.toContain("qwertyuiopasdfgh");
    expect(masked).toContain("bearer ");
    expect(masked).toContain("BEARER ");
  });

  it("手机号、邮箱等正文内容原样保留", () => {
    const text = "联系 13800138000 或 writer@example.com";
    expect(scrubText(text)).toBe(text);
  });

  it("空串返回空串", () => {
    expect(scrubText("")).toBe("");
  });
});

describe("scrubArgs", () => {
  it("递归脱敏对象与数组里的所有字符串叶子", () => {
    const args = {
      label: "替换开头",
      edits: [
        { quote: "旧句子", replacement: "密钥 sk-abcdefghijklmnopqrstu" },
        { quote: "另一处", replacement: "正常文字" },
      ],
    };
    const result = scrubArgs(args) as typeof args;
    expect(result.label).toBe("替换开头");
    expect(result.edits[0].replacement).toBe(`密钥 ${MASK}`);
    expect(result.edits[1].replacement).toBe("正常文字");
    expect(result.edits[0].quote).toBe("旧句子");
  });

  it("保留非字符串叶子的原始类型", () => {
    const result = scrubArgs({ limit: 3, enabled: true, missing: null }) as Record<string, unknown>;
    expect(result).toEqual({ limit: 3, enabled: true, missing: null });
  });

  it("幂等：脱敏结果再过一次不变", () => {
    const once = scrubArgs({ text: "Bearer abcdefghijklmnop" });
    expect(scrubArgs(once)).toEqual(once);
  });
});
