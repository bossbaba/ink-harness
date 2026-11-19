import { describe, expect, it } from "vitest";
import { parseProposal } from "@/services/ideationService";

/**
 * 构思方案解析：A-15 把自写的弱版 extractJson 换成共享的 parseLooseJson 后，
 * 这里锁住「代码块围栏 / 前后散字 / 引号未转义」三类输出仍能解析，防止回归。
 */
describe("parseProposal", () => {
  const payload = () =>
    '{"titles":["霜夜行","长风歌"],"premise":"一个关于归乡的故事","synopsis":"主角回到故土","audience":"成年读者","style":"冷峻"}';

  it("解析正常 JSON", () => {
    const result = parseProposal(payload());
    expect(result?.titles).toEqual(["霜夜行", "长风歌"]);
    expect(result?.premise).toBe("一个关于归乡的故事");
  });

  it("能处理代码块围栏与前后散字", () => {
    const raw = `好的，方案如下：\n\`\`\`json\n${payload()}\n\`\`\`\n请过目`;
    const result = parseProposal(raw);
    expect(result?.titles).toContain("霜夜行");
  });

  it("设定为空时返回 null，而不是带空字段的对象", () => {
    expect(parseProposal("我没想好")).toBeNull();
    expect(parseProposal("{}")).toBeNull();
  });

  it("对脏字段做防御性裁剪：非数组的 titles 被忽略", () => {
    const result = parseProposal('{"titles":"不是一个数组","premise":"有内容"}');
    expect(result?.titles).toEqual([]);
    expect(result?.premise).toBe("有内容");
  });
});
