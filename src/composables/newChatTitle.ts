/**
 * 给新建的空 Copilot 会话起一个不重复的标签。
 *
 * 带序号是为了让连点「+」的用户看到标签真的多了一条，而不是以为按钮没反应；
 * 标题保留「新对话」前缀，这样首条消息发出后仍会被 useCopilotSession 改成首句问题。
 */
export function nextNewChatTitle(titles: readonly string[]): string {
  const used = new Set(titles);
  if (!used.has("新对话")) return "新对话";
  let index = 2;
  while (used.has(`新对话 ${index}`)) index += 1;
  return `新对话 ${index}`;
}
