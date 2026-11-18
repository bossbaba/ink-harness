import { modelRouter } from "@/services/modelRouter";
import type { ChatMessage, PrivacyScope, PublicationBrief, PublishDocument } from "@/types";

/** 发布物料的请求与解析：一次生成简介、标签、封面简报和投稿信，全部是可编辑草稿。 */
const SYSTEM = [
  "你是一名中文小说的资深编辑与发行策划，正在为《作品》准备投稿与上架物料。",
  "只输出一个 JSON 对象，不要 Markdown 代码块、不要任何解释文字，字段如下：",
  '{"blurb":"150字以内的作品简介，开头要有钩子，结尾留悬念",',
  '"tags":["5个平台常用标签，每个不超过6字"],',
  '"coverBrief":"100字以内给设计师的封面需求简报，写清画面主体、色调与气质",',
  '"queryLetter":"200字以内写给编辑的投稿信，说明类型、字数、核心卖点与完稿情况"}',
  "",
  "【纪律】",
  "1. 只依据提供的信息写，缺失的内容就说未提供，不要替作者编造获奖经历或数据。",
  "2. 标签用投稿平台读者熟悉的词，不要用生造概念。",
  "3. 简介与投稿信不评价作者本人，不堆砌形容词。",
].join("\n");

export function buildBriefMessages(doc: PublishDocument): ChatMessage[] {
  const chapters = doc.chapters
    .map((chapter) => `第${chapter.act}幕 · ${chapter.title}（${chapter.wordCount} 字）`)
    .join("\n");
  const user = [
    `【书名】${doc.title}`,
    `【一句话梗概】${doc.premise || "未提供"}`,
    `【目标读者】${doc.audience || "未提供"}`,
    `【叙事风格】${doc.style || "未提供"}`,
    `【章节目录】\n${chapters || "（还没有章节）"}`,
    "",
    "请按上面的字段输出 JSON。",
  ].join("\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

/** 允许模型包一层代码块或塞前后废话，和审稿报告用同一套宽松解析。 */
function extractObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 解析失败返回 null，调用方把原文摆出来而不是只报一句失败。 */
export function parsePublicationBrief(raw: string): PublicationBrief | null {
  const data = extractObject(raw);
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const blurb = text(record.blurb);
  const coverBrief = text(record.coverBrief);
  const queryLetter = text(record.queryLetter);
  const tags = Array.isArray(record.tags)
    ? record.tags
        .map((tag) => text(tag))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  if (!blurb && !coverBrief && !queryLetter && tags.length === 0) return null;
  return { blurb, tags, coverBrief, queryLetter };
}

/** 请求模型生成物料，返回原文供解析与降级展示。 */
export async function requestPublicationBrief(
  doc: PublishDocument,
  privacy: PrivacyScope,
  projectId: string,
  onChunk?: (received: number) => void,
): Promise<string> {
  await modelRouter.refresh();
  const model = modelRouter.select({ task: "publish", privacy, projectId });
  if (!model) throw new Error("没有可用模型，请先在模型管理里配置并启用 Provider。");

  let raw = "";
  const handle = modelRouter.chat(
    { task: "publish", privacy, projectId },
    buildBriefMessages(doc),
    (chunk) => {
      if (!chunk.delta) return;
      raw += chunk.delta;
      onChunk?.(raw.length);
    },
  );
  await handle.done.catch(() => undefined);
  if (!raw.trim()) throw new Error("模型没有返回内容，可以再试一次。");
  return raw;
}
