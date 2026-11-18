/** 某个分组维度的一行：key 是状态或 kind，count 是数量。 */
export interface StatCountItem {
  key: string;
  count: number;
}

/** 全局统计总览：跨所有作品聚合，只读。 */
export interface WorkspaceStats {
  projects: number;
  chapters: number;
  totalWords: number;
  storyElements: number;
  scenes: number;
  foreshadows: number;
  projectsByStatus: StatCountItem[];
  chaptersByStatus: StatCountItem[];
  elementsByKind: StatCountItem[];
}

/** 状态与 kind 的技术标识换成中文，未登记的按原文显示。 */
export const PROJECT_STATUS_ORDER: Array<{ key: string; label: string }> = [
  { key: "idea", label: "构思" },
  { key: "outline", label: "大纲" },
  { key: "drafting", label: "初稿" },
  { key: "review", label: "编辑" },
  { key: "published", label: "已发布" },
];

export const CHAPTER_STATUS_ORDER: Array<{ key: string; label: string }> = [
  { key: "planned", label: "待写" },
  { key: "drafting", label: "写作中" },
  { key: "done", label: "已完成" },
];

export const ELEMENT_KIND_LABEL: Record<string, string> = {
  character: "人物",
  place: "地点",
  org: "组织",
  term: "术语",
  event: "事件",
};
