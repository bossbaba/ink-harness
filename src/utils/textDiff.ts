/**
 * 审稿 Diff 用的短文本字符级对比。
 *
 * 按 Unicode 码点切分，中文不会被拆成半个 UTF-16 字符；只用于「原文片段 → 替换文本」
 * 这类几百字以内的对比，超过上限就整段替换，避免 O(n*m) 的动态规划卡住界面。
 */
export type DiffKind = "equal" | "del" | "add";

export interface DiffSegment {
  kind: DiffKind;
  text: string;
}

/** 超过这个长度不值得逐字比对，直接标成整段删除 + 整段新增。 */
const MAX_DIFF_CHARS = 600;

/** 求两段文字的增删改片段，相同部分合并成一段，方便模板里直接渲染。 */
export function diffText(before: string, after: string): DiffSegment[] {
  const a = Array.from(before);
  const b = Array.from(after);
  if (a.length > MAX_DIFF_CHARS || b.length > MAX_DIFF_CHARS) {
    return [
      ...(a.length ? ([{ kind: "del", text: before }] as DiffSegment[]) : []),
      ...(b.length ? ([{ kind: "add", text: after }] as DiffSegment[]) : []),
    ];
  }

  const n = a.length;
  const m = b.length;
  // dp[i][j]：a 从第 i 个字、b 从第 j 个字开始的最长公共子序列长度。
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  const push = (kind: DiffKind, char: string): void => {
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) last.text += char;
    else segments.push({ kind, text: char });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", a[i]);
      i += 1;
    } else {
      push("add", b[j]);
      j += 1;
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return segments;
}
