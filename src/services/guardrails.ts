/**
 * Guardrails：工具结果的脱敏过滤（前端侧）。
 *
 * Rust 侧已在流式输出与审计落库处脱敏；但 Agent 工具的观察结果由前端 service 直接
 * 拼进下一轮提示词与界面气泡，不经过网关输出通道——如果工具读到的正文里恰好有凭据
 * （作者贴了配置片段），就会被原样送进模型与聊天记录，所以这里再拦一道。
 *
 * 规则与 `src-tauri/src/services/guardrails.rs` 保持一致：只拦凭据特征，
 * 不动手机号/身份证/邮箱（小说正文里出现这些是正常情节）。
 */

/** 脱敏占位文本，与 Rust 侧同文案，便于作者理解发生了什么。 */
export const MASK = "[已屏蔽:疑似凭据]";

/** 常见凭据前缀与「前缀之后至少多少个合法字符」，与 Rust 侧同步维护。 */
const TOKEN_PREFIXES: Array<[string, number]> = [
  ["sk-", 16],
  ["sk-ant-", 16],
  ["ghp_", 20],
  ["gho_", 20],
  ["github_pat_", 20],
  ["xoxb-", 10],
  ["AKIA", 12],
  ["AIza", 20],
];

/** 凭据主体允许的字符：字母数字、下划线、连字符，遇到其它字符即视为结束。 */
function isTokenChar(char: string): boolean {
  return /[A-Za-z0-9_-]/.test(char);
}

/** 匹配 `prefix + 一段凭据主体` 并整体替换。 */
function maskPrefixed(text: string, prefix: string, minLength: number): string {
  let out = "";
  let rest = text;
  for (;;) {
    const at = rest.indexOf(prefix);
    if (at < 0) break;
    out += rest.slice(0, at);
    const after = rest.slice(at + prefix.length);
    let end = 0;
    while (end < after.length && isTokenChar(after[end])) end += 1;
    if (end >= minLength) {
      out += MASK;
      rest = after.slice(end);
    } else {
      // 长度不够就当普通文本，保留前缀继续往后找下一个候选。
      out += prefix;
      rest = after;
    }
  }
  return out + rest;
}

/** 脱敏 `Bearer xxx` 里的令牌；短于 12 个字符的按普通英文词处理。 */
function maskBearer(text: string): string {
  const marker = "Bearer ";
  let out = "";
  let rest = text;
  for (;;) {
    const at = rest.indexOf(marker);
    if (at < 0) break;
    out += rest.slice(0, at + marker.length);
    const after = rest.slice(at + marker.length);
    let end = 0;
    while (end < after.length && !/[\s"']/.test(after[end])) end += 1;
    const token = after.slice(0, end);
    if (token.length >= 12) {
      out += MASK;
      rest = after.slice(end);
    } else {
      rest = after;
    }
  }
  return out + rest;
}

/** 脱敏 PEM 私钥块：从 BEGIN 到 END 整段替换，找不到 END 就把剩余全部屏蔽。 */
function maskPem(text: string): string {
  const begin = "-----BEGIN";
  const endMarker = "-----END";
  let out = "";
  let rest = text;
  for (;;) {
    const at = rest.indexOf(begin);
    if (at < 0) break;
    out += rest.slice(0, at);
    const tail = rest.slice(at);
    const endAt = tail.indexOf(endMarker);
    if (endAt < 0) {
      out += MASK;
      rest = "";
      break;
    }
    const afterEnd = tail.slice(endAt);
    const lineEnd = afterEnd.indexOf("\n");
    out += MASK;
    rest = tail.slice(endAt + (lineEnd < 0 ? afterEnd.length : lineEnd));
  }
  return out + rest;
}

/** 对任意文本做凭据脱敏；工具结果与界面展示前都应过一遍。 */
export function scrubText(text: string): string {
  if (!text) return "";
  let out = text;
  for (const [prefix, minLength] of TOKEN_PREFIXES) {
    out = maskPrefixed(out, prefix, minLength);
  }
  out = maskBearer(out);
  return maskPem(out);
}

/**
 * 递归脱敏工具参数里的所有字符串。
 *
 * 写工具在入队时就把参数洗一遍，审批通过后原样执行——如果等 run 落库后再脱敏，
 * 界面上看到的「已屏蔽」只是回执文案，带凭据的原文早就写进正文了。
 * 对象与数组都保留原结构，只替换字符串叶子；非字符串原样返回。
 */
export function scrubArgs(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubArgs);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = scrubArgs(item);
    return out;
  }
  return value;
}
