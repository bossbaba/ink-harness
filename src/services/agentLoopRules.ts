import { toToolDefinitions } from "@/services/agentTools";
import type { ChatMessage, CollectedToolCall } from "@/types";
import { parseLooseJson } from "@/utils/looseJson";

/**
 * Agent Loop 的提示词与解析辅助。
 *
 * 从 agentLoop.ts 拆出以控制单文件行数：这里都是纯函数，不持有循环状态，
 * 只负责「给模型的规则文本」与「模型输出 → 结构化调用」两个方向的转换。
 */

/**
 * 把工具定义渲染成降级轨提示里的清单。
 *
 * 之前这里是手写的固定字符串，与实际注册表两份维护——加一个工具很容易漏改，
 * 模型在降级轨里就永远看不到它。现在从已下发的工具定义现生成，顺带按角色白名单
 * 自动收窄：角色只允许读章节时，清单里也不会出现写工具。
 */
function fallbackToolList(tools: ReturnType<typeof toToolDefinitions>): string {
  return tools
    .map((tool) => {
      const schema = tool.function.parameters as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const required = new Set(schema.required ?? []);
      const names = Object.keys(schema.properties ?? {});
      const args = names.map((name) => (required.has(name) ? `${name}*` : `${name}?`));
      return `- ${tool.function.name}(${args.join(",")})：${tool.function.description}`;
    })
    .join("\n");
}

/**
 * 标准轨（模型支持 function calling）的工具使用提示。
 *
 * 只把 tools 丢给上游是不够的：system 里既有「作品上下文」又写着「没有的信息就说未设定」，
 * 模型会很自然地直接照着上下文作答，甚至回一句「作品尚未建立任何设定」——实测 Agent 评测
 * 5 条用例全部 `calls: []`。所以这里显式写清「先取数据再回答」，并重复工具名，
 * 避免模型忽略 tools 参数。
 */
export function buildToolRule(tools = toToolDefinitions()): string {
  return [
    "【工具使用】",
    "1. 只要问题涉及作品内容（作品信息、设定、章节、资料检索），本轮第一步必须是调用工具；拿到工具结果之前，不得输出任何作品相关内容。",
    "2. 禁止凭上下文中已有的片段作答：上下文字段可能缺失或过期，作品数据一律以工具返回为准。",
    "3. 除非工具明确返回「没有 / 不存在」，不要回答「未设定」「暂无」「尚未建立」。",
    "4. 一轮可以并行调用多个工具，拿到结果后再组织回答；同一个工具不要反复调用来回试。",
    "5. 自检：如果你的回答里出现具体人物、情节或设定，而本轮没有调用过工具，说明你在编造，必须改成先调用工具。",
    "6. 可用工具（按用途选择，读正文用 read_chapter、找资料用 search_notes，别用列表工具代替）：",
    // 带上用途而不是只列名字：只给名字时小模型经常拿 list_elements 当「读内容」用。
    ...tools.map((tool) => `- ${tool.function.name}：${firstSentence(tool.function.description)}`),
  ].join("\n");
}

/** 取描述的第一句：工具描述都写成「一句话用途 + 补充说明」，清单里只要第一句。 */
function firstSentence(text: string): string {
  const end = text.indexOf("。");
  return end > 0 ? text.slice(0, end + 1) : text;
}

/**
 * JSON 降级轨的提示词：让不支持 function calling 的模型以约定格式表达工具调用。
 * 带 `*` 的参数是必填项，和正式 schema 的 required 对齐。
 */
export function buildFallbackRule(tools = toToolDefinitions()): string {
  return [
    "【工具调用】",
    "需要作品数据（作品信息、设定条目、章节正文、检索片段）时，必须先输出如下 JSON 获取，",
    "不要凭上下文空白直接回答「未设定」「暂无」。只输出 JSON，不要其它文字：",
    '{"tool_calls":[{"name":"工具名","arguments":{参数对象}}]}',
    "可用工具：",
    fallbackToolList(tools),
    "确实不需要作品数据时，直接正常回答，不要输出上述 JSON。",
  ].join("\n");
}

/** 首轮没调工具时的补问：直接说下一步动作，比再讲一遍规则更容易被小模型执行。 */
export const TOOL_RETRY_PROMPT =
  "刚才那一步没有调用任何工具。请先调用工具读取所需的作品数据（如 get_project、list_elements、read_chapter、search_notes），再回答上面的问题。";

/** 从降级轨的文本里抠出工具调用；不是约定 JSON 时返回空数组。 */
export function parseFallbackCalls(text: string): CollectedToolCall[] {
  const value = parseLooseJson(text.trim());
  if (!value || typeof value !== "object") return [];
  const calls = (value as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as { name?: unknown; arguments?: unknown };
    if (typeof raw.name !== "string" || !raw.name) return [];
    const args = raw.arguments && typeof raw.arguments === "object" ? raw.arguments : {};
    return [
      {
        id: `fallback-${index}-${raw.name}`,
        name: raw.name,
        arguments: args as Record<string, unknown>,
        rawArguments: JSON.stringify(args),
        parseError: "",
      },
    ];
  });
}

/** 把一组调用转成 assistant 消息里的 tool_calls 字段（OpenAI 要求原样回传）。 */
export function assistantToolCalls(calls: CollectedToolCall[]): ChatMessage["toolCalls"] {
  return calls.map((call) => ({
    id: call.id,
    type: "function" as const,
    function: { name: call.name, arguments: call.rawArguments },
  }));
}

/** 把一组调用拼成用于空转检测的特征串。 */
export function signature(calls: CollectedToolCall[]): string {
  return calls.map((call) => `${call.name}:${JSON.stringify(call.arguments)}`).join("|");
}
