import { describe, expect, it } from "vitest";
import { parseFirstJsonObject, parseLooseJson, parseLooseJsonArray } from "@/utils/looseJson";

/**
 * 宽松 JSON 解析单测：覆盖模型输出最常见的三种「不是合法 JSON」的坏法，
 * 以及正常路径。构思向导 / 审稿报告的解析都依赖这里，行为要锁死。
 */
describe("parseLooseJson", () => {
  it("解析正常的 JSON 对象与数组", () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseLooseJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("剥离 Markdown 代码块围栏", () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("忽略 JSON 前后的散字", () => {
    expect(parseLooseJson('好的，结果如下：\n{"a":1}\n希望有帮助')).toEqual({ a: 1 });
  });

  it("修复字符串内未转义的半角引号", () => {
    // 台词里的引号是正文，不该把整份 JSON 判为无效。
    expect(parseLooseJson('{"text":"他说：\\"快跑。\\""}')).toEqual({ text: '他说："快跑。"' });
  });

  it("完全解析不出时返回 null", () => {
    expect(parseLooseJson("这不是 JSON")).toBeNull();
    expect(parseLooseJson("")).toBeNull();
  });
});

describe("parseLooseJsonArray", () => {
  it("直接解析数组", () => {
    expect(parseLooseJsonArray('[{"id":1},{"id":2}]')).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("展开 {issues:[...]} 外层容器", () => {
    expect(parseLooseJsonArray('{"issues":[{"id":1}]}')).toEqual([{ id: 1 }]);
  });

  it("逐条抠出被截断数组里的完整对象", () => {
    // 末尾缺 ] 且第二条被截断，仍应拿到第一条完整对象。
    const raw = '[{"id":1,"ok":true},{"id":2,"ok":fal';
    expect(parseLooseJsonArray(raw)).toEqual([{ id: 1, ok: true }]);
  });

  it("无内容时返回空数组", () => {
    expect(parseLooseJsonArray("没有结果")).toEqual([]);
  });
});

describe("parseFirstJsonObject", () => {
  it("连写多个对象时只取第一段", () => {
    expect(parseFirstJsonObject('{"query":"江游 芯片"}{}')).toEqual({ query: "江游 芯片" });
  });

  it("忽略对象前后的说明文字，但不接受数组", () => {
    expect(parseFirstJsonObject('好的：\n{"a":1}\n以上')).toEqual({ a: 1 });
    expect(parseFirstJsonObject("[1,2]")).toBeNull();
  });

  it("没有完整对象时返回 null", () => {
    expect(parseFirstJsonObject("这不是 JSON")).toBeNull();
  });
});
