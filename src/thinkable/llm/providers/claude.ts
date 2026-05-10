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

// 单一 fetch helper，stream 路径与 generate 路径共用，避免重复构造。
async function fetchClaude(
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
 * 共享 SSE 解析器。
 *
 * 同时被 streamWithClaude 与 generateWithClaude 在"代理只返回 SSE"路径下复用。
 * 关键点：tool 参数通过 `input_json_delta` 增量到达，必须在 content_block_stop
 * 时才能 JSON.parse 出完整对象，所以 tool-call 事件在 stop 时才 yield。
 */
async function* parseClaudeSSE(
  body: ReadableStream<Uint8Array>,
  model: string
): AsyncGenerator<LlmStreamEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let pending = "";
  let fullText = "";
  const toolCalls: LlmToolCall[] = [];
  // 按 index 跟踪每个 tool_use block 的部分 JSON
  const toolBuffers = new Map<number, { id: string; name: string; partialJson: string }>();

  yield { type: "start", provider: "claude", model };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    pending += decoder.decode(value, { stream: true });
    const frames = pending.split("\n\n");
    pending = frames.pop() ?? "";

    for (const frame of frames) {
      const lines = frame.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));
      if (!eventLine || !dataLine) continue;

      const eventName = eventLine.slice(7);
      let payload: { [key: string]: unknown };
      try {
        payload = JSON.parse(dataLine.slice(6));
      } catch {
        // 个别代理偶尔会发出非 JSON 心跳行，跳过即可
        continue;
      }

      if (
        eventName === "content_block_start" &&
        (payload.content_block as { type?: string } | undefined)?.type === "tool_use"
      ) {
        const block = payload.content_block as {
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        };
        const input = block.input;
        // 兼容旧格式 / 简化代理：input 已在 start 时完整给出，直接 yield。
        if (input && typeof input === "object" && Object.keys(input).length > 0) {
          const toolCall: LlmToolCall = {
            id: block.id ?? "",
            name: (block.name ?? "wait") as LlmToolCall["name"],
            arguments: input
          };
          toolCalls.push(toolCall);
          yield { type: "tool-call", toolCall };
        } else {
          // 标准 Anthropic SSE：input 通过后续 input_json_delta 累积，stop 时收尾。
          const idx = (payload.index as number) ?? toolBuffers.size;
          toolBuffers.set(idx, {
            id: block.id ?? "",
            name: block.name ?? "wait",
            partialJson: ""
          });
        }
      }

      if (eventName === "content_block_delta") {
        const delta = payload.delta as
          | { type?: string; text?: string; partial_json?: string }
          | undefined;
        if (delta?.type === "text_delta") {
          const text = delta.text ?? "";
          if (text) {
            fullText += text;
            yield { type: "text-delta", text };
          }
        } else if (delta?.type === "input_json_delta") {
          const idx = (payload.index as number) ?? -1;
          const buf = toolBuffers.get(idx);
          if (buf) buf.partialJson += delta.partial_json ?? "";
        }
      }

      if (eventName === "content_block_stop") {
        const idx = (payload.index as number) ?? -1;
        const buf = toolBuffers.get(idx);
        if (buf) {
          let args: Record<string, unknown> = {};
          if (buf.partialJson) {
            try {
              args = JSON.parse(buf.partialJson);
            } catch {
              // tool 参数 JSON 损坏时退回空对象，让上层 handler 报错而非整轮 fail
              args = {};
            }
          }
          const toolCall: LlmToolCall = {
            id: buf.id,
            name: buf.name as LlmToolCall["name"],
            arguments: args
          };
          toolCalls.push(toolCall);
          yield { type: "tool-call", toolCall };
          toolBuffers.delete(idx);
        }
      }
    }
  }

  yield { type: "done", text: fullText, toolCalls, raw: undefined };
}

// Claude 非流式请求把 content 数组中的文本和 tool call 拼成统一结果。
// 兼容性补丁：当代理服务忽略 stream:false 直接返回 SSE 时，fallback 到 SSE 聚合。
export async function generateWithClaude(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): Promise<LlmGenerateResult> {
  const model = params.model ?? config.model;
  const response = await fetchClaude(config, params, false);

  if (!response.ok) {
    throw new Error(`Claude 请求失败: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") && response.body) {
    // 代理只返回 SSE：复用共享解析器把流聚合成单一结果。
    let text = "";
    let toolCalls: LlmToolCall[] = [];
    for await (const event of parseClaudeSSE(response.body, model)) {
      if (event.type === "done") {
        text = event.text;
        toolCalls = event.toolCalls;
      }
    }
    return { provider: "claude", model, text, toolCalls };
  }

  const raw = await response.json();
  const text = (raw.content ?? [])
    .filter((item: { type?: string }) => item.type === "text")
    .map((item: { text?: string }) => item.text ?? "")
    .join("");
  const toolCalls = toClaudeToolCalls(raw.content);

  return {
    provider: "claude",
    model,
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
  const response = await fetchClaude(config, params, true);

  if (!response.ok || !response.body) {
    throw new Error(`Claude 流式请求失败: ${response.status}`);
  }

  yield* parseClaudeSSE(response.body, model);
}
