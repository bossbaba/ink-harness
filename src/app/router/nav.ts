/**
 * 导航表：侧栏菜单与路由表的单一来源。
 *
 * 之前菜单项写死在 AppShell 里、路由写在 router 里，两处各改一遍很容易漂移
 * （新增页面忘了加菜单，或菜单指向不存在的路由）。这里集中定义，两边都从这里取。
 */
import type { AppIconName } from "@/components/common/appIcons";

export interface GlobalNavItem {
  /** 高亮判定用的稳定标识。 */
  key: string;
  label: string;
  /** 语义图标名，由 AppIcon 统一渲染，不再用会随字体漂移的字符。 */
  icon: AppIconName;
  /** 全局页路径（不带作品作用域）。 */
  path: string;
}

export interface ProjectNavItem {
  key: string;
  label: string;
  icon: AppIconName;
  /** 子路由名，跳转与高亮都按 name 走，避免拼路径。 */
  name: string;
}

/** 全局导航：只放真正有全局页面的功能。 */
export const GLOBAL_NAV: GlobalNavItem[] = [
  { key: "workspace", label: "工作台", icon: "workspace", path: "/" },
  { key: "stats", label: "统计", icon: "stats", path: "/stats" },
  { key: "bible", label: "设定库", icon: "bible", path: "/bible" },
  { key: "models", label: "模型管理", icon: "models", path: "/models" },
  // Agent 的两个全局配置页与模型管理同级：它们对所有作品生效，不属于某部作品。
  { key: "agent-roles", label: "Agent 角色", icon: "models", path: "/agent-roles" },
  { key: "agent-eval", label: "Agent 评测", icon: "stats", path: "/agent-eval" },
];

/** 作品内二级导航：每一项都有对应子路由，不存在禁用占位。 */
export const PROJECT_NAV: ProjectNavItem[] = [
  { key: "ideation", label: "构思向导", icon: "ideation", name: "project-ideation" },
  { key: "bible", label: "设定库", icon: "bible", name: "project-bible" },
  { key: "outline", label: "大纲", icon: "outline", name: "project-outline" },
  { key: "write", label: "写作台", icon: "write", name: "project-writing" },
  { key: "review", label: "编辑审稿", icon: "review", name: "project-review" },
  { key: "publish", label: "出版中心", icon: "publish", name: "project-publish" },
  { key: "workflow", label: "创作工作流", icon: "workflow", name: "project-workflow" },
];
