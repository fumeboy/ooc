import type { LlmEnvConfig, LlmGenerateParams, LlmInputItem, LlmTool } from "../types";

function isMessageItem(item: LlmInputItem): item is Extract<LlmInputItem, { type: "message" }> {
  return item.type === "message";
}

/**
 * Claude API 的 `messages` 字段要求至少一条非 system 消息；OOC 把 context 几乎全部
 * 编码进 system role（参见 processEventToItems：inbox_message_arrived / inject 都 → system），
 * 真实请求经常出现 messages 为空的情况——Anthropic 官方会回 400，部分代理会 200 + 空 body
 * 让重试无意义。
 *
 * 这里在 Claude transport 边界补一条 placeholder user message，保持 OOC "context 走 system"
 * 的设计不动，只把"协议侧的非空契约"满足在适配器内。OpenAI 走 Responses API 用 `input`
 * 数组，不存在这个约束，因此该兜底只放在 Claude 这一侧。
 */
const CLAUDE_FALLBACK_USER_MESSAGE = "Continue based on the context above.";

function toClaudeMessages(items: LlmInputItem[]) {
  const messages = items
    .filter(isMessageItem)
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
  if (messages.length === 0) {
    return [{ role: "user" as const, content: CLAUDE_FALLBACK_USER_MESSAGE }];
  }
  return messages;
}

// Claude 的 system 需要从统一 items 中单独提取。
function toClaudeSystem(items: LlmInputItem[], instructions?: string) {
  return [instructions, ...items
    .filter(isMessageItem)
    .filter((message) => message.role === "system")
    .map((message) => message.content)]
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join("\n\n");
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
