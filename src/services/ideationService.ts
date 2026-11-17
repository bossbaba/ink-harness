import type {
  ChatMessage,
  IdeaProposal,
  IdeationAnswers,
  ProposalAct,
  ProposalChapter,
  ProposalScene,
} from "@/types";

/** 新建一份空白访谈答案，类型与读者沿用作品已有信息。 */
export function createIdeationAnswers(project: {
  genre: string;
  audience: string;
}): IdeationAnswers {
  return {
    inspiration: "",
    genre: project.genre,
    audience: project.audience,
    protagonist: "",
    antagonist: "",
    conflict: "",
    world: "",
    style: "",
    length: "长篇",
  };
}

/** 解析失败时的兜底空方案：让用户仍能手动填写并写入作品。 */
export function createEmptyProposal(): IdeaProposal {
  return {
    titles: [],
    premise: "",
    synopsis: "",
    audience: "",
    style: "",
    outline: [],
  };
}

const SYSTEM_PROMPT = `你是一位资深中文小说策划编辑，擅长把零散灵感整理成可执行的立项方案。
请只输出一个 JSON 对象，不要 Markdown 代码块、不要任何额外解释，字段必须完整：
{
  "titles": ["3 个风格不同的书名候选"],
  "premise": "一句话梗概，40 字以内，包含主角、目标与阻力",
  "synopsis": "200~300 字作品简介，适合放在作品详情页",
  "audience": "目标读者画像，50 字以内",
  "style": "叙事风格与基调，30 字以内",
  "outline": [
    {
      "act": 1,
      "chapters": [
        {
          "title": "章节名",
          "summary": "本章梗概，40 字以内",
          "scenes": [
            {
              "title": "场景名",
              "pov": "视角人物",
              "location": "地点",
              "timeMark": "时间标记",
              "summary": "场景概要"
            }
          ]
        }
      ]
    }
  ]
}
要求：
1. outline 固定三幕：第一幕 3 章（建置）、第二幕 4 章（对抗升级）、第三幕 2 章（结局与伏笔回收）。
2. 每章 1~2 个场景；场景信息缺失时填空字符串，不要省略字段。
3. 用户信息不足时按类型惯例合理补全，不要反问，也不要输出与 JSON 无关的内容。
4. 除 JSON 对象外不要输出任何字符。`;

/** 把访谈答案拼成一条 user 消息；空字段显式标注，让模型知道需要补全。 */
export function buildIdeationMessages(answers: IdeationAnswers): ChatMessage[] {
  const filled = (value: string) => value.trim() || "（未填写，请合理补全）";
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `灵感：${filled(answers.inspiration)}`,
        `类型：${filled(answers.genre)}`,
        `目标读者：${filled(answers.audience)}`,
        `主角（是谁、想要什么）：${filled(answers.protagonist)}`,
        `对手或阻力：${filled(answers.antagonist)}`,
        `核心冲突：${filled(answers.conflict)}`,
        `世界与时代：${filled(answers.world)}`,
        `叙事风格与基调：${filled(answers.style)}`,
        `篇幅预期：${answers.length}`,
      ].join("\n"),
    },
  ];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter(Boolean)
    .slice(0, max);
}

function normalizeScene(value: unknown): ProposalScene | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = asString(raw.title);
  if (!title) return null;
  return {
    title,
    pov: asString(raw.pov),
    location: asString(raw.location),
    timeMark: asString(raw.timeMark),
    summary: asString(raw.summary),
  };
}

function normalizeChapter(value: unknown): ProposalChapter | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = asString(raw.title);
  if (!title) return null;
  const scenes = Array.isArray(raw.scenes)
    ? raw.scenes
        .map(normalizeScene)
        .filter((scene): scene is ProposalScene => scene !== null)
        .slice(0, 3)
    : [];
  return { title, summary: asString(raw.summary), scenes };
}

function normalizeAct(value: unknown): ProposalAct | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const act = Number(raw.act);
  if (act !== 1 && act !== 2 && act !== 3) return null;
  const chapters = Array.isArray(raw.chapters)
    ? raw.chapters
        .map(normalizeChapter)
        .filter((chapter): chapter is ProposalChapter => chapter !== null)
        .slice(0, 8)
    : [];
  return { act, chapters };
}

/** 模型偶尔会把 JSON 包在代码块或前后废话里，这里取第一个 { 到最后一个 }。 */
function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 把模型输出解析成方案；完全不可用时返回 null，由页面提示重新生成或手动填写。
 * 对数组/字段做防御性裁剪，避免模型多输出导致界面出现脏数据。
 */
export function parseProposal(raw: string): IdeaProposal | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const data = parsed as Record<string, unknown>;

  const acts = Array.isArray(data.outline)
    ? data.outline
        .map(normalizeAct)
        .filter((act): act is ProposalAct => act !== null)
        .sort((a, b) => a.act - b.act)
    : [];

  const proposal: IdeaProposal = {
    titles: asStringArray(data.titles, 5),
    premise: asString(data.premise),
    synopsis: asString(data.synopsis),
    audience: asString(data.audience),
    style: asString(data.style),
    outline: acts,
  };

  const hasContent =
    proposal.titles.length > 0 ||
    proposal.premise ||
    proposal.synopsis ||
    proposal.outline.length > 0;
  return hasContent ? proposal : null;
}
