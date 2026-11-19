/** 设定库条目的五种类型。 */
export type StoryElementKind = "character" | "place" | "org" | "event" | "term";

/** 条目之间的关系（有向）。 */
export interface StoryRelation {
  targetId: string;
  type: string;
  label?: string;
}

/** 扩展字段：别名、时间线、备注与关系都放在 detail JSON 中。 */
export interface StoryElementDetail {
  aliases?: string[];
  timeStart?: string;
  timeEnd?: string;
  notes?: string;
  relations?: StoryRelation[];
  [key: string]: unknown;
}

export interface StoryElement {
  id: string;
  projectId: string;
  kind: StoryElementKind;
  name: string;
  summary: string;
  detail: StoryElementDetail;
  createdAt: string;
  updatedAt: string;
}

/** 全局设定库条目：条目本身 + 所属作品标题。 */
export interface StoryElementOverview extends StoryElement {
  projectTitle: string;
}

export interface NewStoryElement {
  projectId: string;
  kind: StoryElementKind;
  name: string;
  summary?: string;
  detail?: StoryElementDetail;
}

export type ConsistencyIssueKind =
  | "duplicate-name"
  | "timeline-conflict"
  | "invalid-time-range"
  | "broken-relation";

export interface ConsistencyIssue {
  id: string;
  kind: ConsistencyIssueKind;
  severity: "warning" | "info";
  title: string;
  detail: string;
  elementIds: string[];
}

export const STORY_KIND_OPTIONS: Array<{
  label: string;
  value: StoryElementKind;
  icon: string;
}> = [
  { label: "人物", value: "character", icon: "人" },
  { label: "地点", value: "place", icon: "地" },
  { label: "组织", value: "org", icon: "组" },
  { label: "时间线", value: "event", icon: "时" },
  { label: "术语", value: "term", icon: "词" },
];

export const STORY_KIND_LABEL: Record<StoryElementKind, string> = {
  character: "人物",
  place: "地点",
  org: "组织",
  event: "时间线",
  term: "术语",
};

export const STORY_KIND_ICON: Record<StoryElementKind, string> = {
  character: "人",
  place: "地",
  org: "组",
  event: "时",
  term: "词",
};

export const RELATION_TYPE_OPTIONS = [
  { label: "关联", value: "related-to" },
  { label: "位于", value: "located-in" },
  { label: "属于", value: "member-of" },
  { label: "相识", value: "knows" },
  { label: "对立", value: "conflicts-with" },
  { label: "发生于", value: "happened-at" },
];

/**
 * 查关系类型（内部编码，如 `related-to`）对应的中文；未登记时返回 undefined。
 * 给需要「映射不到就换别的文案」的场景用（如关系图优先用用户自定义标签）。
 */
export function findRelationTypeLabel(type: string): string | undefined {
  return RELATION_TYPE_OPTIONS.find((option) => option.value === type)?.label;
}

/**
 * 关系类型转成界面显示的中文。
 * 界面只允许中文，绝不能把 type 原值直接渲染到标签上；
 * 遇到未登记的自定义类型时统一显示「其他」，不回落成英文编码。
 */
export function relationTypeLabel(type: string): string {
  return findRelationTypeLabel(type) ?? "其他";
}

export const CONSISTENCY_KIND_LABEL: Record<ConsistencyIssueKind, string> = {
  "duplicate-name": "名称重复",
  "timeline-conflict": "时间线重叠",
  "invalid-time-range": "时间倒置",
  "broken-relation": "关联失效",
};
