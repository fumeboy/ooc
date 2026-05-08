import type {
  LlmEnvConfig,
  LlmGenerateParams,
  LlmGenerateResult,
  LlmMessage,
  LlmStreamEvent,
  LlmTool,
  LlmToolCall
} from "../types";

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

// Claude 的非流式 content 中会同时出现 text 与 tool_use block。
function toClaudeToolCalls(content: unknown): LlmToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .filter((item) => (item as { type?: string }).type === "tool_use")
    .map((item) => ({
      id: (item as { id?: string }).id ?? "",
      name: ((item as { name?: string }).name ?? "wait") as LlmToolCall["name"],
      arguments: (item as { input?: Record<string, unknown> }).input ?? {}
    }));
}

// Claude 非流式请求把 content 数组中的文本和 tool call 拼成统一结果。
export async function generateWithClaude(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): Promise<LlmGenerateResult> {
  const response = await fetch(`${config.baseUrl}/v1/messages`, {
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
      stream: false
    })
  });

  // Claude HTTP 失败时直接抛错，让上层决定如何处理。
  if (!response.ok) {
    throw new Error(`Claude 请求失败: ${response.status}`);
  }

  const raw = await response.json();
  const text = (raw.content ?? [])
    .filter((item: { type?: string }) => item.type === "text")
    .map((item: { text?: string }) => item.text ?? "")
    .join("");
  const toolCalls = toClaudeToolCalls(raw.content);

  return {
    provider: "claude",
    model: params.model ?? config.model,
    text,
    toolCalls,
    raw
  };
}

// Claude 流式事件以 SSE 形式返回，需要同时提取文本和 tool_use。
export async function* streamWithClaude(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): AsyncIterable<LlmStreamEvent> {
  const model = params.model ?? config.model;
  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      system: toClaudeSystem(params.messages),
      messages: toClaudeMessages(params.messages),
      tools: toClaudeTools(params.tools),
      temperature: params.temperature,
      max_tokens: params.maxTokens ?? 1024,
      stream: true
    })
  });

  // 流式路径必须同时检查状态码和响应体是否可读。
  if (!response.ok || !response.body) {
    throw new Error(`Claude 流式请求失败: ${response.status}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let pending = "";
  let fullText = "";
  const toolCalls: LlmToolCall[] = [];

  // 统一流模型总是先发出 start 事件。
  yield { type: "start", provider: "claude", model };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    // Claude 也是 SSE，需要按空行切成一帧一帧解析。
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split("\n\n");
    pending = frames.pop() ?? "";

    for (const frame of frames) {
      const lines = frame.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));

      if (!eventLine || !dataLine) {
        continue;
      }

      const eventName = eventLine.slice(7);
      const payload = JSON.parse(dataLine.slice(6));

      // Claude 文本增量位于 delta.text 字段。
      if (eventName === "content_block_delta") {
        const delta = payload.delta?.text ?? "";

        if (!delta) {
          continue;
        }

        fullText += delta;
        yield { type: "text-delta", text: delta };
      }

      // Claude 工具块在完整出现时直接产出 tool-call。
      if (eventName === "content_block_start" && payload.content_block?.type === "tool_use") {
        const toolCall = {
          id: payload.content_block.id ?? "",
          name: (payload.content_block.name ?? "wait") as LlmToolCall["name"],
          arguments: payload.content_block.input ?? {}
        };

        toolCalls.push(toolCall);
        yield { type: "tool-call", toolCall };
      }
    }
  }

  // done 事件把整段文本和工具列表返回给统一门面，便于后续聚合复用。
  yield { type: "done", text: fullText, toolCalls, raw: undefined };
}
