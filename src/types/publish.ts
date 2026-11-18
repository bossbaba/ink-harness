/** 排版模板：网络连载 / 电子书 / 纸质稿，差别在版心、行距与分隔方式。 */
export type PublishTemplate = "web" | "ebook" | "print";

/** 导出格式：PDF 走系统打印对话框，其余由端侧直接写文件。 */
export type ExportFormat = "md" | "html" | "epub" | "docx" | "pdf";

/** 导出给排版器的一章：正文已转成纯文本，不依赖编辑器。 */
export interface PublishChapter {
  id: string;
  title: string;
  act: number;
  summary: string;
  text: string;
  wordCount: number;
}

/** 导出所需的全部数据，一次读齐后各格式共用。 */
export interface PublishDocument {
  title: string;
  author: string;
  premise: string;
  audience: string;
  style: string;
  chapters: PublishChapter[];
}

/** 写文件命令的返回值。 */
export interface ExportResult {
  path: string;
  size: number;
}

/** AI 生成的发布物料，都是草稿，作者可逐项编辑后再复制。 */
export interface PublicationBrief {
  blurb: string;
  tags: string[];
  coverBrief: string;
  queryLetter: string;
}

export const PUBLISH_TEMPLATE_LABEL: Record<PublishTemplate, string> = {
  web: "网络连载",
  ebook: "电子书",
  print: "纸质稿",
};

export const PUBLISH_TEMPLATE_HINT: Record<PublishTemplate, string> = {
  web: "段落短、行距松，适合手机连载阅读。",
  ebook: "章节分页、衬线正文，适合阅读器。",
  print: "按 A4 版心排版，适合打印或交给排版软件。",
};

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  md: "Markdown",
  html: "HTML",
  epub: "EPUB",
  docx: "DOCX",
  pdf: "PDF（打印）",
};

/** 发布清单：只记平台要求与勾选状态，不代替作者真的去投稿。 */
export interface PublishPlatform {
  key: string;
  label: string;
  note: string;
}

export const PUBLISH_PLATFORMS: PublishPlatform[] = [
  { key: "qidian", label: "起点中文网", note: "男频为主，注重更新稳定与开头的钩子" },
  { key: "fanqie", label: "番茄小说", note: "免费阅读，节奏快、章节短更吃香" },
  { key: "jjwxc", label: "晋江文学城", note: "女频为主，简介与标签决定第一眼点击" },
  { key: "douban", label: "豆瓣阅读", note: "偏文学与类型中短篇，适合完整性与质感" },
  { key: "weread", label: "微信读书", note: "多为版权合作，先备好样章与完整大纲" },
  { key: "zhihu", label: "知乎盐选", note: "第一人称强情节开头，分节悬念要密" },
];

/** 一次发布计划，日期由作者在页面上挑，不做自动排期。 */
export interface PublishEntry {
  platform: string;
  date: string;
  note: string;
}
