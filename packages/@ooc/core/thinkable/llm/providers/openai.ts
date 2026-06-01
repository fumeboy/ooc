import OpenAI from "openai";
import type { ResponseInputItem, FunctionTool } from "openai/resources/responses/responses";
import type {
  LlmEnvConfig,
  LlmGenerateParams,
  LlmGenerateResult,
  LlmInputItem,
  LlmStreamEvent,
  LlmTool,
  LlmToolCall
} from "../types";

// OpenAI tools 统一映射为 function calling 结构。
function toOpenAiTools(tools: LlmTool[] | undefined): FunctionTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: true
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

function toOpenAiInputItem(item: LlmInputItem): ResponseInputItem {
  if (item.type === "message") {
    return {
      type: "message",
      role: item.role,
      content: [{
        type: "input_text",
        text: item.content
      }]
    };
  }
  if (item.type === "function_call") {
    return {
      type: "function_call",
      call_id: item.call_id,
      name: item.name,
      arguments: JSON.stringify(item.arguments)
    };
  }
  if (item.type === "function_call_output") {
    return {
      type: "function_call_output",
      call_id: item.call_id,
      output: item.output
    };
  }
  return {
    type: "message",
    role: "assistant",
    content: [{
      type: "input_text",
      text: `[reasoning]\n${item.text}`
    }]
  };
}

function extractOutputText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if ((part as { type?: string }).type === "output_text") {
        return (part as { text?: string }).text ?? "";
      }
      if ((part as { type?: string }).type === "text") {
        return (part as { text?: string }).text ?? "";
      }
      return "";
    })
    .join("");
}

function toOpenAiOutputItems(rawOutput: unknown): LlmInputItem[] {
  if (!Array.isArray(rawOutput)) {
    return [];
  }

  const outputItems: LlmInputItem[] = [];
  for (const item of rawOutput) {
    const raw = item as Record<string, unknown>;
    if (raw.type === "message") {
      outputItems.push({
        type: "message" as const,
        role: (raw.role as "system" | "user" | "assistant" | undefined) ?? "assistant",
        content: extractOutputText(raw.content)
      });
      continue;
    }
    if (raw.type === "function_call") {
      outputItems.push({
        type: "function_call" as const,
        call_id: (raw.call_id as string | undefined) ?? "",
        name: ((raw.name as string | undefined) ?? "wait") as LlmToolCall["name"],
        arguments: JSON.parse((raw.arguments as string | undefined) ?? "{}")
      });
      continue;
    }
    if (raw.type === "reasoning") {
      outputItems.push({
        type: "reasoning" as const,
        text: typeof raw.summary === "string"
          ? raw.summary
          : Array.isArray(raw.summary)
            ? raw.summary.map((item) => (item as { text?: string }).text ?? "").join("")
            : ""
      });
    }
  }
  return outputItems;
}

export function createOpenAiClient(config: LlmEnvConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl
  });
}

function formatOpenAiError(error: unknown): string {
  const status = (error as { status?: number }).status;
  const detail = (error as { error?: { message?: string; code?: string; param?: string } }).error;
  const message = detail?.message || (error as { message?: string }).message;
  const meta = [
    detail?.code ? `code=${detail.code}` : undefined,
    detail?.param ? `param=${detail.param}` : undefined
  ].filter(Boolean).join(", ");
  const suffix = message ? ` - ${message}${meta ? ` (${meta})` : ""}` : "";

  return typeof status === "number"
    ? `OpenAI 请求失败: ${status}${suffix}`
    : `OpenAI 请求失败${suffix}`;
}

// OpenAI 非流式请求直接走 Responses API，并返回统一结果。
export async function generateWithOpenAi(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): Promise<LlmGenerateResult> {
  const client = createOpenAiClient(config);
  let raw: { output: unknown };
  try {
    raw = await client.responses.create({
      model: params.model ?? config.model,
      input: params.input.map(toOpenAiInputItem),
      instructions: params.instructions,
      tools: toOpenAiTools(params.tools),
      temperature: params.temperature,
      max_output_tokens: params.maxTokens,
      store: false
    }) as { output: unknown };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (typeof status === "number") {
      throw new Error(formatOpenAiError(error));
    }
    throw error;
  }
  const outputItems = toOpenAiOutputItems(raw.output);
  const text = outputItems
    .filter((item): item is Extract<LlmInputItem, { type: "message" }> => item.type === "message")
    .map((item) => item.content)
    .join("");
  const toolCalls = outputItems
    .filter((item): item is Extract<LlmInputItem, { type: "function_call" }> => item.type === "function_call")
    .map((item) => ({
      id: item.call_id,
      name: item.name,
      arguments: item.arguments
    }));

  return {
    provider: "openai",
    model: params.model ?? config.model,
    outputItems,
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
      input: params.input.map(toOpenAiInputItem),
      instructions: params.instructions,
      tools: toOpenAiTools(params.tools),
      temperature: params.temperature,
      max_output_tokens: params.maxTokens,
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
