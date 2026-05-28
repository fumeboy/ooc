import type { LlmEnvConfig, LlmGenerateParams, LlmInputItem, LlmTool } from "../types";

/**
 * inbox_message_arrived 事件在 processEventToItems 里被映射成 role=system 的 message，
 * content 形如 "[context_change:inbox_message_arrived] msg_id=X source=talk from=ObjY window_id=W\n<真实正文>"。
 * Claude transport 边界识别这个前缀，把它从 system 上下文里挪出来作为 user 消息，
 * 让 Claude 看到一条真正的"用户对话起点"。
 * 详见 spec: docs/superpowers/specs/2026-05-17-wait-requires-dependency-design.md
 * 与 docs/solutions/conventions/reuse-before-introducing-new-concepts-2026-05-17.md
 * 的"边界适配优于核心改造"理念。
 */
const INBOX_MARKER = "[context_change:inbox_message_arrived]";

/**
 * Claude 对话必须以 user 消息开头。极少数情况——thread 完全没有 inbox / 没有
 * function call 历史——messages 会空。补一条 placeholder 维持协议契约。
 */
const CLAUDE_FALLBACK_USER_MESSAGE = "Continue based on the context above.";

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
type ClaudeContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
}

function isInboxMarker(content: string): boolean {
  return content.startsWith(INBOX_MARKER);
}

/** 从 "[marker] msg_id=... from=...\n<正文>" 里抽出 \n 之后的真实正文（兜底返回整串）。 */
function extractInboxContent(systemText: string): string {
  const newlineIdx = systemText.indexOf("\n");
  if (newlineIdx === -1) return systemText;
  return systemText.slice(newlineIdx + 1);
}

/**
 * 把 OOC 的 LlmInputItem[]（Responses-first 模型）转换成 Claude 的 messages 数组。
 *
 * 关键映射：
 * - role=system inbox 标记 → user 文本块（保持对话起点的语义）
 * - 其余 role=system message → 不进 messages，由 toClaudeSystem 收集进 system 字段
 * - role=user / role=assistant message → 对应 role 的文本块
 * - function_call → assistant 上的 tool_use 块
 * - function_call_output → user 上的 tool_result 块（Anthropic 协议要求这样表达 tool 结果）
 * - reasoning → 跳过（Claude 输入不接受 reasoning 块）
 *
 * 同一 role 的连续 items 合并到一条 message 的 content blocks，不同 role 之间切断。
 */
function toClaudeMessages(items: LlmInputItem[]): ClaudeMessage[] {
  const out: ClaudeMessage[] = [];
  let currentRole: "user" | "assistant" | null = null;
  let blocks: ClaudeContentBlock[] = [];

  const flush = () => {
    if (currentRole && blocks.length > 0) {
      out.push({ role: currentRole, content: blocks });
    }
    blocks = [];
  };

  const ensureRole = (role: "user" | "assistant") => {
    if (currentRole !== role) {
      flush();
      currentRole = role;
    }
  };

  for (const item of items) {
    if (item.type === "reasoning") continue;
    if (item.type === "message") {
      if (item.role === "system") {
        if (isInboxMarker(item.content)) {
          ensureRole("user");
          blocks.push({ type: "text", text: extractInboxContent(item.content) });
        }
        // 非 inbox 的 system message 留给 toClaudeSystem 收集，不进 messages
        continue;
      }
      ensureRole(item.role);
      blocks.push({ type: "text", text: item.content });
      continue;
    }
    if (item.type === "function_call") {
      ensureRole("assistant");
      blocks.push({
        type: "tool_use",
        id: item.call_id,
        name: item.name,
        input: item.arguments,
      });
      continue;
    }
    if (item.type === "function_call_output") {
      ensureRole("user");
      blocks.push({
        type: "tool_result",
        tool_use_id: item.call_id,
        content: item.output,
      });
      continue;
    }
  }
  flush();

  // Claude 要求对话以 user 开头；若 messages 空或首条不是 user，前置一条 placeholder
  if (out.length === 0 || out[0]?.role !== "user") {
    out.unshift({ role: "user", content: CLAUDE_FALLBACK_USER_MESSAGE });
  }
  return out;
}

// Claude system 字段：instructions + 所有"非 inbox 标记"的 system message。
function toClaudeSystem(items: LlmInputItem[], instructions?: string): string {
  const parts: string[] = [];
  if (instructions) parts.push(instructions);
  for (const item of items) {
    if (item.type !== "message" || item.role !== "system") continue;
    if (isInboxMarker(item.content)) continue;
    parts.push(item.content);
  }
  return parts.filter((s) => s.length > 0).join("\n\n");
}

// Claude tools 可以直接按统一结构映射过去。
function toClaudeTools(tools: LlmTool[] | undefined) {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }));
}

// 单一 fetch helper，stream 路径与 generate 路径共用，避免重复构造。
export async function fetchClaude(
  config: LlmEnvConfig,
  params: LlmGenerateParams,
  stream: boolean
): Promise<Response> {
  return fetch(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: params.model ?? config.model,
      system: toClaudeSystem(params.input, params.instructions),
      messages: toClaudeMessages(params.input),
      tools: toClaudeTools(params.tools),
      temperature: params.temperature,
      max_tokens: params.maxTokens ?? 1024,
      stream
    })
  });
}

/**
 * 对 Claude 非流式请求做有限重试。
 * 仅对"空响应 / 非法 JSON"这类代理兼容问题重试，其它错误直接抛出。
 */
export async function retryClaudeGenerate<T>(
  operation: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const message = lastError.message ?? "";
      const retriable =
        message.includes("不是合法 JSON 对象") || message.includes("空响应");
      if (!retriable || attempt === maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  throw lastError ?? new Error("Claude 请求未返回结果");
}
