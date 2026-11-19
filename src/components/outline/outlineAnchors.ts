/**
 * 大纲看板的滚动锚点 id。
 *
 * 目录（OutlineToc）和幕区块（OutlineBoard）要跳同一批位置，id 规则集中在这里，
 * 避免两边各写一份字符串、改一处忘另一处。
 */
export const actAnchorId = (act: number): string => `outline-act-${act}`;

export const chapterAnchorId = (chapterId: string): string => `outline-chapter-${chapterId}`;
