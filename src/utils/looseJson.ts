/**
 * 宽松读取模型输出里的 JSON。
 *
 * 模型（尤其本地小模型）的输出常常「看起来是 JSON」，但不满足严格语法，两种坏法最常见：
 * 1. 字符串里直接写半角引号却不转义（典型：台词 `他说："快跑。"`），
 *    JSON.parse 会在第一个内嵌引号处提前结束字符串，整份输出作废；
 * 2. 输出被 max_tokens 截断，末尾的 `]`、`}` 直接丢了。
 *
 * 所以这里的顺序是：先按原样切出数组/对象解析；失败就把字符串内部的裸引号转义后重试；
 * 仍失败就按花括号配对逐条抠对象，坏一条不至于把其它条目一起丢掉。
 */

/** 去掉 Markdown 代码块围栏，只留里面的内容。 */
function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "").replace(/```/g, "");
}

/** 解析失败返回 null：调用方只关心对象/数组，所以不需要区分「合法 null」。 */
function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 引号后面紧跟这些字符时，它是 JSON 的结构引号（键值分界），不是正文里的引号。 */
function isStructuralNext(ch: string | undefined): boolean {
  return ch === undefined || ch === ":" || ch === "," || ch === "}" || ch === "]";
}

/**
 * 把字符串值内部未转义的半角双引号补上转义。
 * 判据是「引号后面（跳过空白）不是 : , } ] 或文本结尾」——正常 JSON 里只有键名和值结尾才会出现引号。
 */
function repairBareQuotes(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }
    // 已有的转义序列整体照搬，别把 \" 又转义一次
    if (ch === "\\") {
      out += ch + (text[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === '"') {
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      if (isStructuralNext(text[next])) {
        out += ch;
        inString = false;
      } else {
        // 正文里的引号：转义后 JSON.parse 就能把这段当成同一个字符串
        out += '\\"';
      }
      continue;
    }
    // 字符串里的裸换行/制表符同样是非法 JSON，顺带转义
    if (ch === "\n") {
      out += "\\n";
      continue;
    }
    if (ch === "\r") {
      out += "\\r";
      continue;
    }
    if (ch === "\t") {
      out += "\\t";
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 切出最外层容器再解析：模型常在 JSON 前后写废话。
 *
 * 关键是不能见 `[` 就切——构思方案的 JSON 是「对象里套 titles 数组」，
 * 若优先切首个 `[`…`]`，会把 titles 数组当成整份结果，丢掉其余字段。
 * 所以按「哪种括号先出现」判断最外层容器，先解析它，失败再退回另一种。
 */
function sliceJson(text: string): unknown {
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  const arraySlice =
    arrayStart >= 0 && arrayEnd > arrayStart ? text.slice(arrayStart, arrayEnd + 1) : null;
  const objectSlice =
    objectStart >= 0 && objectEnd > objectStart ? text.slice(objectStart, objectEnd + 1) : null;
  const objectFirst = objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart);
  const ordered = objectFirst ? [objectSlice, arraySlice] : [arraySlice, objectSlice];
  for (const candidate of ordered) {
    if (candidate === null) continue;
    const value = tryParse(candidate);
    if (value !== null) return value;
  }
  return null;
}

/** 统一成「条目数组」：数组本身，或者 `{ issues: [...] }` 里的内层数组。 */
function toItemArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const issues = (value as { issues?: unknown }).issues;
    if (Array.isArray(issues)) return issues;
  }
  return [];
}

/** 按花括号配对抠出文本里所有对象（含嵌套层），字符串内的花括号会被跳过。 */
function scanObjects(text: string): string[] {
  const stack: number[] = [];
  const found: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push(i);
    } else if (ch === "}" && stack.length > 0) {
      const start = stack.pop();
      if (start !== undefined) found.push(text.slice(start, i + 1));
    }
  }
  return found;
}

/** 解析整段输出（数组或对象都认），失败返回 null。 */
export function parseLooseJson(text: string): unknown {
  const cleaned = stripFences(text);
  for (const variant of [cleaned, repairBareQuotes(cleaned)]) {
    const value = sliceJson(variant);
    if (value !== null) return value;
  }
  return null;
}

/** 只接受 JSON 对象；数组、null、标量都不是工具参数。 */
function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 工具参数专用：取文本里第一个能解析的 JSON 对象。
 *
 * 模型偶尔把两次调用的参数连着写进同一个 arguments（如 `{"query":"..."}{}`），
 * 或在对象前后带一句说明；整段严格解析必然失败，但第一段对象通常是有效的，
 * 直接判失败会让同一次工具调用永远不执行。这里按括号配对逐个尝试，
 * 拿到第一个对象就返回，剩余内容留在 rawArguments 里供排查。
 */
export function parseFirstJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = stripFences(text);
  for (const variant of [cleaned, repairBareQuotes(cleaned)]) {
    const direct = asObject(tryParse(variant));
    if (direct) return direct;
    for (const chunk of scanObjects(variant)) {
      const value = asObject(tryParse(chunk));
      if (value) return value;
    }
  }
  return null;
}

/**
 * 读出模型输出里的条目数组。
 * 整段能解析就用整段；解析不了（某条引号没转义、或被截断）就逐条抠对象，拿到一条算一条。
 */
export function parseLooseJsonArray(text: string): unknown[] {
  const direct = toItemArray(parseLooseJson(text));
  if (direct.length > 0) return direct;

  const cleaned = stripFences(text);
  // 先修引号再扫括号：未闭合的字符串会让花括号配对整体错位
  for (const variant of [repairBareQuotes(cleaned), cleaned]) {
    const items: unknown[] = [];
    const seen = new Set<string>();
    for (const chunk of scanObjects(variant)) {
      const value = tryParse(chunk);
      if (value === null || typeof value !== "object") continue;
      const nested = toItemArray(value);
      // `{issues:[...]}` 这类外层容器展开成条目；普通对象本身就是一条
      for (const item of nested.length > 0 ? nested : [value]) {
        const key = JSON.stringify(item);
        // 外层容器与内层条目会扫出同一份内容，用序列化结果去重
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }
    if (items.length > 0) return items;
  }
  return [];
}
