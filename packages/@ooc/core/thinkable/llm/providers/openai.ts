import OpenAI from "openai";
import type { ResponseInputItem, FunctionTool } from "openai/resources/responses/responses";
import type {
  LlmEnvConfig,
  LlmGenerateParams,
  LlmGenerateResult,
  LlmInputItem,
  LlmTool,
  LlmToolCall
} from "../types";

/**
 * 宽容地解析 LLM 返回的 tool call 参数。
 *
 * 上游模型 (特别是 OpenAI-compatible 代理如 Ark) 可能在 arguments 字段里返回
 * 自然语言文本、空字符串、截断 JSON 等非 JSON 内容。裸 JSON.parse 会抛异常并
 * 让整条 think 循环进入 failed 状态 (参见 thinkloop.ts 的顶层 catch)，使得
 * 后续所有上下文都无法推进。
 *
 * 这里做三层 fallback：
 *   1. 原串直接 JSON.parse
 *   2. 尝试包裹成对象形式（模型偶尔只吐出 value 部分）
 *   3. 回退到 `{ _raw: originalString }`，保证上层永远拿到一个对象；同时
 *      调用方可以通过检测 `_raw` 字段知道这是降级结果。
 */
function safeParseArguments(raw: unknown): Record<string, unknown> {
  const s = typeof raw === "string" ? raw : "";
  if (!s) return {};
  const trimmed = s.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // 模型吐出了单个值（字符串、数字、数组）——包一层作为回退
    return { _raw: parsed as unknown };
  } catch {
    // 不是合法 JSON：记录原文，让 LLM 下一轮自己看到错误输出并修正
    return { _raw: trimmed };
  }
}

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
      arguments: safeParseArguments(rawArguments)
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
        arguments: safeParseArguments(raw.arguments)
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
