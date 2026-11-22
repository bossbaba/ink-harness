/**
 * 输入框里 `@` / `/` 触发面板的判定。
 *
 * `@` 打开引用选择，`/` 打开 Agent 角色菜单。
 * 抽成纯函数是为了能单测：这段逻辑全在输入框事件里，靠手点很难覆盖
 * 邮箱、链接、粘贴、输入法整串上屏这些边界；判定错了会表现为「打 @ 没反应」
 * 或「打邮箱时莫名弹出面板」。
 */
export interface AtTrigger {
  /** 快捷符在被插入文本里的下标。 */
  index: number;
  /** 去掉这个快捷符之后的草稿文本，调用方直接把它写回输入框。 */
  draft: string;
}

/**
 * 紧跟在字母/数字/邮箱常见符号后面的 `@` 不当作触发符：
 * 那是 `name@example.com`、`@someone` 这类写法，弹面板会打断输入。
 * 中文、空白、标点之后都算正常引用场景（「你好@第一章」也很常用）。
 */
const WORD_TAIL = /[A-Za-z0-9._%+-]$/;

/** `//` 或 `http://` 里的斜杠不当作快捷入口，避免贴链接时弹菜单。 */
const PATH_TAIL = /[:/]$/;

/**
 * 判断这次的输入值是否刚好插入了一个可触发面板的快捷符（`@` 引用、`/` 角色）。
 *
 * 只在「长度 +1 且其余字符不变」时判定：粘贴、输入法整串上屏、选区替换都不触发，
 * 否则一次粘贴里的 `@` 会把焦点从输入框抢走。
 */
export function detectTrigger(prev: string, next: string, mark: "@" | "/"): AtTrigger | null {
  if (next.length !== prev.length + 1) return null;

  // 找到第一个差异位；它必须就是新插入的字符。
  let index = 0;
  while (index < prev.length && prev[index] === next[index]) index += 1;
  if (next[index] !== mark) return null;
  // 插入点之后必须与旧文本完全一致，排除「在中间替换字符」这种非纯插入。
  if (next.slice(index + 1) !== prev.slice(index)) return null;

  const tail = prev.slice(0, index);
  if (mark === "@" && WORD_TAIL.test(tail)) return null;
  if (mark === "/" && PATH_TAIL.test(tail)) return null;

  return {
    index,
    draft: `${next.slice(0, index)}${next.slice(index + 1)}`,
  };
}
