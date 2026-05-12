import type {
  LlmEnvConfig,
  LlmGenerateParams,
  LlmGenerateResult,
  LlmInputItem,
  LlmStreamEvent,
  LlmToolCall
} from "../types";
import { collectClaudeSseResult, parseClaudeSSE } from "./claude-sse";
import { fetchClaude, retryClaudeGenerate } from "./claude-transport";

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

function toClaudeOutputItems(content: unknown): LlmInputItem[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const outputItems: LlmInputItem[] = [];
  for (const item of content) {
    if ((item as { type?: string }).type === "text") {
      outputItems.push({
        type: "message" as const,
        role: "assistant",
        content: (item as { text?: string }).text ?? ""
      });
      continue;
    }
    if ((item as { type?: string }).type === "tool_use") {
      outputItems.push({
        type: "function_call" as const,
        call_id: (item as { id?: string }).id ?? "",
        name: ((item as { name?: string }).name ?? "wait") as LlmToolCall["name"],
        arguments: (item as { input?: Record<string, unknown> }).input ?? {}
      });
    }
  }
  return outputItems;
}

// Claude 非流式请求把 content 数组中的文本和 tool call 拼成统一结果。
// 兼容性补丁：当代理服务忽略 stream:false 直接返回 SSE 时，fallback 到 SSE 聚合。
// 部分代理偶发对正常请求回 null/空 body，做最多 2 次重试。
export async function generateWithClaude(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): Promise<LlmGenerateResult> {
  const model = params.model ?? config.model;
  return retryClaudeGenerate(() => generateOnce(config, params, model));
}

async function generateOnce(
  config: LlmEnvConfig,
  params: LlmGenerateParams,
  model: string
): Promise<LlmGenerateResult> {
  const response = await fetchClaude(config, params, false);
  if (!response.ok) {
    throw new Error(`Claude 请求失败: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") && response.body) {
    const { text, toolCalls } = await collectClaudeSseResult(response.body, model);
    return {
      provider: "claude",
      model,
      outputItems: [
        ...(text ? [{ type: "message", role: "assistant", content: text } satisfies LlmInputItem] : []),
        ...toolCalls.map((toolCall) => ({
          type: "function_call" as const,
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments
        }))
      ],
      text,
      toolCalls
    };
  }

  const bodyText = await response.text();
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") {
    if (process.env.OOC_DEBUG_LLM === "1") {
      console.error("[claude debug] non-JSON body (status=", response.status, "ct=", contentType, ") len=", bodyText.length, "first200=", bodyText.slice(0, 200));
    }
    throw new Error(`Claude 响应不是合法 JSON 对象: ${JSON.stringify(raw)}`);
  }
  const content = (raw as { content?: unknown }).content;
  const text = (Array.isArray(content) ? content : [])
    .filter((item: { type?: string }) => item.type === "text")
    .map((item: { text?: string }) => item.text ?? "")
    .join("");
  const toolCalls = toClaudeToolCalls(content);
  const outputItems = toClaudeOutputItems(content);

  return {
    provider: "claude",
    model,
    outputItems,
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
