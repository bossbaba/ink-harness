import { tauriApi } from "@/api/tauri";
import { EMPTY_REPLY_MESSAGE, runChat } from "@/services/aiChat";
import { fitContext } from "@/services/aiContext";
import { settingsService } from "@/services/settingsService";
import type {
  ApplyWorkflowInput,
  Chapter,
  ChatMessage,
  PrivacyScope,
  Project,
  TaskKind,
  WorkflowDecision,
  WorkflowStage,
  WorkflowStageState,
  WorkflowState,
} from "@/types";
import { WORKFLOW_STAGES } from "@/types";

/** 工作流状态存在 app_meta，键按作品隔离；作品删除后残留一个无主键，量极小不做清理。 */
const STATE_PREFIX = "workflow:";
const STATE_VERSION = 1;

/** 单个候选产物进入提示词前的上限：防止把整本书塞进一次请求。 */
const ARTIFACT_LIMIT = 8000;

/**
 * 设定库约束：所有阶段都必须沿用已登记的人物/地点，不能自创关键角色。
 * 之前只有写作/审稿把设定库带进提示词，策划/编辑/出版都没带，模型会另起炉灶，
 * 生成与设定库无关的角色名（例如设定里是张三/李四，正文却写成林深/零号）。
 */
const SETTING_RULE = [
  "【人物与设定】严格沿用【设定与大纲】或【作品背景】中设定库已登记的姓名、别名与关系，",
  "不得自创新的关键角色，也不得给已有角色改名；只有设定库确实为空时才按类型惯例补全。",
].join("");

function emptyStage(): WorkflowStageState {
  return {
    status: "idle",
    artifact: "",
    error: "",
    model: "",
    decision: "",
    decidedAt: "",
    note: "",
  };
}

/** 全新工作流：五个阶段都未开始，未选章节。 */
export function createWorkflowState(): WorkflowState {
  const stages = {} as Record<WorkflowStage, WorkflowStageState>;
  for (const stage of WORKFLOW_STAGES) stages[stage.key] = emptyStage();
  return { version: STATE_VERSION, selectedChapterId: "", stages, updatedAt: "" };
}

/**
 * 读取工作流状态。老数据缺字段时按空阶段补齐，避免加了新阶段后页面读到 undefined。
 * 解析失败当全新状态处理，工作流是辅助视图，不该因为一段坏 JSON 打不开。
 */
export async function loadWorkflowState(projectId: string): Promise<WorkflowState> {
  const raw = await settingsService.getString(`${STATE_PREFIX}${projectId}`);
  const fresh = createWorkflowState();
  if (!raw) return fresh;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkflowState>;
    if (parsed.version !== STATE_VERSION || !parsed.stages) return fresh;
    for (const stage of WORKFLOW_STAGES) {
      const saved = parsed.stages[stage.key];
      if (saved && typeof saved === "object")
        fresh.stages[stage.key] = { ...emptyStage(), ...saved };
    }
    fresh.selectedChapterId =
      typeof parsed.selectedChapterId === "string" ? parsed.selectedChapterId : "";
    fresh.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
    return fresh;
  } catch {
    return fresh;
  }
}

/** 写回整份状态；调用方在每次状态变更后立即保存，避免工作流进度丢失。 */
export async function saveWorkflowState(projectId: string, state: WorkflowState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await settingsService.setString(`${STATE_PREFIX}${projectId}`, JSON.stringify(state));
}

/**
 * 审批落地：把「写正文 + 写阶段状态」交给后端一次事务完成。
 * 单独的状态写仍用于运行阶段/选章等不涉及正文的场景。
 */
export async function applyWorkflow(input: ApplyWorkflowInput): Promise<void> {
  await tauriApi.applyWorkflow(input);
}

function clip(text: string): string {
  const value = text.trim();
  return value.length <= ARTIFACT_LIMIT ? value : `${value.slice(0, ARTIFACT_LIMIT)}\n…（已截断）`;
}

/** 作品事实，给各阶段提示词共用的开头。 */
function projectFacts(project: Project): string {
  return [
    `【作品】${project.title}`,
    `【类型】${project.genre || "未定"}`,
    `【一句话梗概】${project.premise || "未提供"}`,
    `【目标读者】${project.audience || "未提供"}`,
    `【叙事风格】${project.style || "未提供"}`,
  ].join("\n");
}

/**
 * 按阶段组装消息。策划/出版复用已立项、出版服务的提示词规则保持一致，
 * 写作/编辑/审稿在这里拼——它们面向「整个阶段产物」而非编辑器选区。
 */
export function buildStageMessages(input: {
  stage: WorkflowStage;
  project: Project;
  chapter: Chapter | null;
  chapterText: string;
  context: string;
  previous: string;
}): ChatMessage[] {
  const { stage, project, chapter, chapterText, context, previous } = input;
  const facts = projectFacts(project);
  const background = fitContext(context, ARTIFACT_LIMIT) || "（设定与大纲暂未提供）";

  if (stage === "ideation") {
    return [
      {
        role: "system",
        content: [
          "你是中文小说的资深策划编辑。请依据作品现有信息输出一份可执行的立项方案。",
          "只输出 JSON 对象，不要代码块和解释。字段：titles(3个候选书名)、premise(40字内一句话)、synopsis(200~300字简介)、audience(50字内)、style(30字内)、outline(三幕，每幕chapters数组，章含title与40字内summary)。",
          "outline 固定三幕：3/4/2 章；信息不足时按类型惯例补全，不要反问。",
          SETTING_RULE,
        ].join("\n"),
      },
      {
        role: "user",
        content: `${facts}\n\n【设定与大纲】\n${background}\n\n请输出方案 JSON。`,
      },
    ];
  }

  if (stage === "writing") {
    return [
      {
        role: "system",
        content: [
          "你是中文小说写手，正在按大纲写章节初稿。",
          "只输出正文，不要标题、解释或 Markdown。用空行分段，600~1000 字，沿用给定风格与人称。",
          "严格依据大纲梗概发生的事，不新增关键设定，写完整的一场戏而非梗概复述。",
          SETTING_RULE,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          facts,
          `【作品背景】\n${background}`,
          `【本章】第${chapter?.act ?? 1}幕 · ${chapter?.title ?? "未指定章节"}`,
          `【本章梗概】${chapter?.summary || "（未提供，按背景合理展开）"}`,
          "",
          "请写出本章初稿正文。",
        ].join("\n"),
      },
    ];
  }

  if (stage === "editing") {
    return [
      {
        role: "system",
        content: [
          "你是中文小说责编，正在润色一章正文。",
          "只输出润色后的完整正文，不要解释、不要审阅意见、不要 Markdown。",
          "保留原有情节、人物与篇幅，只改用词、句式、节奏与重复表达，不要扩写成新剧情。",
          SETTING_RULE,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          facts,
          `【作品背景】\n${background}`,
          `【章节】第${chapter?.act ?? 1}幕 · ${chapter?.title ?? "未指定章节"}`,
          `【正文】\n${clip(chapterText)}`,
          "",
          "请输出润色后的完整正文。",
        ].join("\n"),
      },
    ];
  }

  if (stage === "review") {
    return [
      {
        role: "system",
        content: [
          "你是中文小说的资深编辑，正在做全书三层审稿。",
          "只输出 JSON 数组，每项字段：layer(structure|consistency|language)、severity(high|medium|low)、title、quote、detail、suggestion、replacement(可直接替换的文本，没有填空串)。",
          "只挑真问题，4~12 条，按严重度排序；没有问题就输出空数组 []。",
          SETTING_RULE,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          facts,
          `【设定与大纲】\n${background}`,
          `【章节目录】\n${previous || "（还没有章节）"}`,
          "",
          "请输出审稿问题 JSON 数组。",
        ].join("\n"),
      },
    ];
  }

  return [
    {
      role: "system",
      content: [
        "你是中文小说的发行策划，正在准备上架物料。",
        "只输出 JSON 对象：blurb(150字内有钩子的简介)、tags(5个标签)、coverBrief(100字内封面需求)、queryLetter(200字内投稿信)。",
        "只依据提供信息，缺失就写未提供，不编造数据。",
        SETTING_RULE,
      ].join("\n"),
    },
    {
      role: "user",
      content: `${facts}\n\n【设定与大纲】\n${background}\n\n请输出物料 JSON。`,
    },
  ];
}

/** 阶段 → 路由任务：工作流阶段名和模型路由的 TaskKind 不完全同名，写作/编辑映射到续写/润色。 */
const STAGE_TASK: Record<WorkflowStage, TaskKind> = {
  ideation: "ideation",
  writing: "continue",
  editing: "polish",
  review: "review",
  publish: "publish",
};

/** 一次流式请求拿全文：五个节点共用，统一刷新 Provider、按任务选模型、按作品隐私约束。 */
export async function requestAgent(
  stage: WorkflowStage,
  ctx: { privacy: PrivacyScope; projectId: string },
  messages: ChatMessage[],
  onChunk?: (received: number) => void,
): Promise<string> {
  const { raw, failure } = await runChat(
    { task: STAGE_TASK[stage], privacy: ctx.privacy, projectId: ctx.projectId },
    messages,
    onChunk,
  );
  if (failure) throw new Error(failure);
  if (!raw.trim()) throw new Error(EMPTY_REPLY_MESSAGE);
  return raw;
}

/** 把审批决定写进阶段状态；通过/打回与产物、时间、备注一起落库留痕。 */
export function decideStage(
  state: WorkflowState,
  stage: WorkflowStage,
  decision: WorkflowDecision,
  note: string,
): void {
  const target = state.stages[stage];
  target.status = decision === "approved" ? "approved" : "rejected";
  target.decision = decision;
  target.decidedAt = new Date().toISOString();
  target.note = note;
  target.error = "";
}
