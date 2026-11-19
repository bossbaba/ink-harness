import type { Project } from "@/types";

/**
 * 作品上下文的纯文本处理。
 *
 * 这些函数不依赖任何 service 或运行时状态，单独成文件是为了避免循环依赖：
 * aiContext 需要从 summaryService 读默认预算，而 summaryService 又要用这里的 fitContext，
 * 两模块互相 import 会在模块初始化时触发 "Cannot access 'DEFAULT_CONTEXT_BUDGET' before initialization"。
 */

/** 作品上下文保留开头（作品信息、设定库、大纲都在前面）。 */
export function head(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（上下文过长，已截断）`;
}

/**
 * 按章节预算裁剪作品上下文，保证「大纲骨架 + 伏笔」一定随 AI 请求带着走。
 *
 * build_context 的输出是 作品信息 → 设定库 → 大纲(章节+场景) → 伏笔，伏笔排在末尾；
 * 直接 head() 只留开头，长作品一旦超预算就把伏笔整段切掉，而伏笔恰恰是续写必须遵守的约束。
 * 这里先抽出伏笔段和章节标题行，剩下的预算才分给正文细节，超长时仍以两者为先。
 */
export function fitContext(text: string, limit: number): string {
  if (!text.trim() || limit <= 0) return "";
  if (text.length <= limit) return text;

  const marker = "## 伏笔";
  const at = text.lastIndexOf(marker);
  const foreshadow = at >= 0 ? text.slice(at).trim() : "";
  // 章节标题是「大纲」的骨架：即便场景细节全被裁掉，作者也知道每章要写什么。
  const chapters = text
    .split("\n")
    .filter((line) => line.startsWith("#### "))
    .join("\n");
  const essentials = [chapters, foreshadow].filter(Boolean).join("\n");
  // 多留 40 字给 head() 自己追加的截断提示，避免结果反而超过预算。
  const room = limit - essentials.length - 40;
  if (room <= 0) return head(essentials, limit);

  // 前半段去掉伏笔再裁，避免 essentials 里的伏笔出现两遍。
  const body = at >= 0 ? text.slice(0, at) : text;
  return `${head(body, room).trim()}\n\n${essentials}\n…（上下文过长，已优先保留章节与伏笔）`;
}

/** 前文保留结尾，续写靠的正是紧邻选区的那几句。 */
export function tail(text: string, limit: number): string {
  return text.length <= limit ? text : `…（前文过长，只保留结尾）\n${text.slice(-limit)}`;
}

/** 作品的四项基本事实；空字段直接跳过，不要给模型一堆「类型：」的空行。 */
export function projectFacts(project: Project): string {
  return [
    project.genre ? `类型：${project.genre}` : "",
    project.premise ? `一句话梗概：${project.premise}` : "",
    project.style ? `叙事风格：${project.style}` : "",
    project.audience ? `目标读者：${project.audience}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
