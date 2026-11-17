/** Copilot 能显式引用的上下文来源：一条设定，或一章已有正文。 */
export type CopilotReferenceKind = "element" | "chapter";

/** 一次「@引用」的选择结果；label 只用于界面展示，正文由 service 现取。 */
export interface CopilotReference {
  kind: CopilotReferenceKind;
  /** 设定条目 id 或章节 id。 */
  id: string;
  /** 展示名：设定名，或「第N幕 · 章节名」。 */
  label: string;
}

export type CopilotRole = "user" | "assistant";

/** 一条对话消息。助手消息由流式分片累加，failed 标记这次回答是否中断/报错。 */
export interface CopilotMessage {
  id: string;
  role: CopilotRole;
  content: string;
  /** 用户提问时选中的引用；助手回答固定为空数组。 */
  references: CopilotReference[];
  failed?: boolean;
}

export const COPILOT_REF_KIND_LABEL: Record<CopilotReferenceKind, string> = {
  element: "设定",
  chapter: "章节",
};

/** 输入框还空着时给的常用问法，点一下填进输入框，省得每次从零想问题。 */
export const COPILOT_QUICK_PROMPTS = [
  "这一章接下来可以怎么走？给三个方向",
  "这段对话是否符合人物性格？哪里要改",
  "本章有没有和已有设定、伏笔冲突的地方",
];
