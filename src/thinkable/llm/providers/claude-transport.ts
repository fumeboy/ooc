import type { LlmEnvConfig, LlmGenerateParams, LlmMessage, LlmTool } from "../types";

// Claude 只接受 user / assistant messages，system 单独提取成顶层字段。
function toClaudeMessages(messages: LlmMessage[]) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

// Claude 的 system 需要从统一 messages 中单独提取。
function toClaudeSystem(messages: LlmMessage[]) {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
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
      system: toClaudeSystem(params.messages),
      messages: toClaudeMessages(params.messages),
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
