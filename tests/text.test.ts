import { describe, expect, it } from "vitest";
import { countCharacters, formatCount, formatDateTime } from "@/utils/text";

/** 字数口径由前端算好后回写后端，是全应用共享的统计基准，行为必须锁定。 */
describe("countCharacters", () => {
  it("去除空白（含全角空格与换行）后按字符计数", () => {
    expect(countCharacters("你 好　世界\n！")).toBe(5);
  });

  it("中英混排逐字符计数", () => {
    expect(countCharacters("hello 世界")).toBe(7);
  });

  it("空串与纯空白为 0", () => {
    expect(countCharacters("")).toBe(0);
    expect(countCharacters(" \t\n")).toBe(0);
  });
});

describe("formatDateTime", () => {
  it("正常 ISO 串格式化为 MM-DD HH:mm", () => {
    const formatted = formatDateTime("2026-11-19T09:05:00");
    expect(formatted).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("非法时间串原样返回，不出现 Invalid Date", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("formatCount", () => {
  it("按中文习惯输出千分位", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});
