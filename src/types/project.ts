/** 作品实体（对应后端 project 表）。 */
export interface Project {
  id: string;
  title: string;
  genre: string;
  premise: string;
  audience: string;
  style: string;
  /** any | local-only */
  privacy: "any" | "local-only";
  /** idea/outline/drafting/review/published */
  status: "idea" | "outline" | "drafting" | "review" | "published";
  createdAt: string;
  updatedAt: string;
}

/** 新建作品输入。 */
export interface NewProject {
  title: string;
  genre?: string;
  premise?: string;
  audience?: string;
  style?: string;
  privacy?: "any" | "local-only";
}

/** 数据库文件信息。 */
export interface DatabaseInfo {
  path: string;
}

export const PROJECT_STATUS_LABEL: Record<Project["status"], string> = {
  idea: "构思",
  outline: "大纲",
  drafting: "初稿",
  review: "编辑",
  published: "已发布",
};
