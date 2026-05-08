import type {
  LlmEnvConfig,
  LlmGenerateParams,
  LlmGenerateResult,
  LlmStreamEvent,
  LlmTool,
  LlmToolCall
} from "../types";

// OpenAI tools 统一映射为 function calling 结构。
function toOpenAiTools(tools: LlmTool[] | undefined) {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

// OpenAI 的 tool call 参数是 JSON 字符串，这里统一转成对象。
function toOpenAiToolCalls(rawToolCalls: unknown): LlmToolCall[] {
  if (!Array.isArray(rawToolCalls)) {
    return [];
  }

  return rawToolCalls.map((item) => {
    const functionCall = (item as { function?: { name?: string; arguments?: string }; id?: string }).function;
    const rawArguments = functionCall?.arguments ?? "{}";

    return {
      id: (item as { id?: string }).id ?? "",
      name: (functionCall?.name ?? "wait") as LlmToolCall["name"],
      arguments: JSON.parse(rawArguments)
    };
  });
}

// OpenAI 非流式请求直接走 chat completions，并返回统一结果。
export async function generateWithOpenAi(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): Promise<LlmGenerateResult> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: params.model ?? config.model,
      messages: params.messages,
      tools: toOpenAiTools(params.tools),
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: false
    })
  });

  // HTTP 层失败时直接抛错，不做额外兜底分支。
  if (!response.ok) {
    throw new Error(`OpenAI 请求失败: ${response.status}`);
  }

  // 非流式路径同时提取文本与 tool call，供 thinkloop 直接消费。
  const raw = await response.json();
  const message = raw.choices?.[0]?.message ?? {};
  const text = message.content ?? "";
  const toolCalls = toOpenAiToolCalls(message.tool_calls);

  return {
    provider: "openai",
    model: params.model ?? config.model,
    text,
    toolCalls,
    raw
  };
}

// OpenAI 流式路径把 SSE 增量归一化成统一事件。
export async function* streamWithOpenAi(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): AsyncIterable<LlmStreamEvent> {
  const model = params.model ?? config.model;
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: params.messages,
      tools: toOpenAiTools(params.tools),
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: true
    })
  });

  // 流式请求需要同时确保状态码成功且存在响应体。
  if (!response.ok || !response.body) {
    throw new Error(`OpenAI 流式请求失败: ${response.status}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let pending = "";
  let fullText = "";
  const toolCallBuffer = new Map<number, { id: string; name: string; arguments: string }>();
  const emittedToolCalls: LlmToolCall[] = [];

  // 统一事件流总是先告诉上层本次请求已经开始。
  yield { type: "start", provider: "openai", model };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    // SSE 可能分片到多个 chunk，需要先拼接再按帧切分。
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split("\n\n");
    pending = frames.pop() ?? "";

    for (const frame of frames) {
      if (!frame.startsWith("data: ")) {
        continue;
      }

      const payload = frame.slice(6);
      if (payload === "[DONE]") {
        continue;
      }

      // OpenAI 兼容流里，文本增量位于 choices[0].delta.content。
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta ?? {};
      const textDelta = delta.content ?? "";

      if (textDelta) {
        fullText += textDelta;
        yield { type: "text-delta", text: textDelta };
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const rawToolCall of delta.tool_calls) {
          const index = rawToolCall.index ?? 0;
          const previous = toolCallBuffer.get(index) ?? { id: "", name: "", arguments: "" };
          const next = {
            id: rawToolCall.id ?? previous.id,
            name: rawToolCall.function?.name ?? previous.name,
            arguments: previous.arguments + (rawToolCall.function?.arguments ?? "")
          };

          toolCallBuffer.set(index, next);
        }
      }
    }
  }

  for (const toolCall of [...toolCallBuffer.values()]) {
    const normalized = {
      id: toolCall.id,
      name: toolCall.name as LlmToolCall["name"],
      arguments: JSON.parse(toolCall.arguments || "{}")
    };

    emittedToolCalls.push(normalized);
    yield { type: "tool-call", toolCall: normalized };
  }

  // done 事件把完整文本和 tool call 交给上层，避免上层自行再聚合一遍。
  yield { type: "done", text: fullText, toolCalls: emittedToolCalls, raw: undefined };
}
