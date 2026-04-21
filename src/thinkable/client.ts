/**
 * LLM 客户端 —— OpenAI 兼容协议实现
 *
 * 提供：
 * - LLMClient 接口
 * - OpenAICompatibleClient：支持智谱 AI 及任何 OpenAI 兼容 API
 * - MockLLMClient：用于测试
 *
 * @ref docs/哲学文档/gene.md#G4 — references — LLM 是 ThinkLoop 的思考引擎
 * @ref src/thinkable/config.ts — references — LLMConfig 配置
 */

import type { LLMConfig } from "./config.js";
import { consola } from "consola";

/** 给 reader.read() 加 per-chunk 超时，防止流式读取无限挂起 */
const readWithTimeout = async (
  reader: any,
  timeoutMs: number,
): Promise<{ done: boolean; value?: Uint8Array }> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("流式读取超时：长时间未收到数据")), timeoutMs);
  });
  try {
    return await Promise.race([reader.read(), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
};

/** Tool Call（LLM 输出的工具调用） */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Tool 定义（传给 LLM 的工具 schema） */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 聊天消息（扩展支持 tool_calls 和 tool 结果） */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** assistant 消息中的 tool calls */
  tool_calls?: ToolCall[];
  /** tool 消息中的 tool_call_id */
  tool_call_id?: string;
}

/** LLM 响应 */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** LLM 双通道结果 */
export interface LLMResult {
  assistantContent: string;
  thinkingContent: string;
  model: string;
  usage: TokenUsage;
  raw: Record<string, unknown>;
}

/** 向后兼容的 LLM 响应 */
export interface LLMResponse extends LLMResult {
  content: string;
  /** tool calls（如果 LLM 选择调用工具） */
  toolCalls?: ToolCall[];
}

/** LLM 流式事件 */
export type LLMStreamEvent =
  | { type: "assistant_chunk"; chunk: string }
  | { type: "thinking_chunk"; chunk: string }
  | { type: "done"; usage?: TokenUsage; raw?: Record<string, unknown> };

/** simpleCall 简化调用选项 */
export interface SimpleLLMOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

/** LLM 客户端接口 */
export interface LLMClient {
  chat(messages: Message[], options?: { tools?: ToolDefinition[] }): Promise<LLMResponse>;
  /** 流式聊天，返回 token 异步迭代器。不支持时 fallback 到 chat() */
  chatStream?(messages: Message[]): AsyncIterable<string>;
  /** 流式聊天（双通道事件） */
  chatEventStream?(messages: Message[]): AsyncIterable<LLMStreamEvent>;
  /** 当前客户端是否启用了 provider-native thinking 语义 */
  isThinkingEnabled?(): boolean;
  /** 当前客户端是否应在开启 thinking 时退回非流式模式 */
  preferNonStreamingThinking?(): boolean;
  /** 简化调用：传入 prompt 返回文本 */
  simpleCall?(prompt: string, options?: SimpleLLMOptions): Promise<string>;
}

function normalizeTextContent(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }

  return "";
}

function previewText(content: string, max = 80): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

export function detectProtocolMarkers(content: string): string[] {
  const markers: string[] = [];
  const trimmed = content.trim();
  if (!trimmed) return markers;

  if (trimmed.includes("```toml")) markers.push("fenced_toml");
  if (/^```/.test(trimmed)) markers.push("leading_fence");
  if (/^\[(program|talk|action|cognize_stack_frame_push|cognize_stack_frame_pop|reflect_stack_frame_push|reflect_stack_frame_pop|set_plan|finish|wait|break)\]/m.test(trimmed)) {
    markers.push("protocol_section");
  }
  if (/\[talk\/user\]/.test(trimmed)) markers.push("legacy_talk_section");
  if (/\[thought\]/.test(trimmed)) markers.push("deprecated_thought_section");

  return markers;
}

export function normalizeUsage(usage: Record<string, unknown> | null | undefined): TokenUsage {
  return {
    promptTokens: typeof usage?.prompt_tokens === "number"
      ? usage.prompt_tokens
      : typeof usage?.promptTokens === "number"
        ? usage.promptTokens
        : undefined,
    completionTokens: typeof usage?.completion_tokens === "number"
      ? usage.completion_tokens
      : typeof usage?.completionTokens === "number"
        ? usage.completionTokens
        : undefined,
    totalTokens: typeof usage?.total_tokens === "number"
      ? usage.total_tokens
      : typeof usage?.totalTokens === "number"
        ? usage.totalTokens
        : undefined,
  };
}

export function extractThinkingContent(message: Record<string, unknown> | null | undefined): string {
  const directThinking = [
    message?.reasoning_content,
    message?.thinking_content,
    message?.thinking,
    message?.reasoning,
  ];

  for (const candidate of directThinking) {
    const normalized = normalizeTextContent(candidate);
    if (normalized) return normalized;
  }

  const thinkingObject = message?.thinking;
  if (thinkingObject && typeof thinkingObject === "object" && "content" in thinkingObject) {
    return normalizeTextContent((thinkingObject as { content?: unknown }).content);
  }

  const reasoningObject = message?.reasoning;
  if (reasoningObject && typeof reasoningObject === "object" && "content" in reasoningObject) {
    return normalizeTextContent((reasoningObject as { content?: unknown }).content);
  }

  return "";
}

function extractAssistantContent(message: Record<string, unknown> | null | undefined): string {
  return normalizeTextContent(message?.content);
}

function buildThinkingCapabilityPayload(config: LLMConfig): Record<string, unknown> | null {
  if (!config.thinking.enabled) return null;

  /*
   * thinking 能力分两层：
   * 1. OOC 运行时启用 thinking 语义（允许捕获 provider 返回的 reasoning/thinking）
   * 2. 是否向上游显式发送 thinking 参数，由 provider 兼容性决定
   *
   * 对 openai-compatible 网关，很多实现会默认返回 reasoning_content，
   * 但不一定接受额外的 thinking payload。只有明确配置 mode/budget 时，
   * 才向上游发送显式 thinking 参数，避免对兼容网关造成 500。
   */
  if (!config.thinking.mode && typeof config.thinking.budget !== "number") {
    return null;
  }

  const thinkingPayload: Record<string, unknown> = {
    type: config.thinking.mode ?? "enabled",
  };

  if (typeof config.thinking.budget === "number" && Number.isFinite(config.thinking.budget)) {
    thinkingPayload.budget = config.thinking.budget;
  }

  return thinkingPayload;
}

export function buildChatPayload(
  config: LLMConfig,
  messages: Message[],
  options?: { stream?: boolean; tools?: ToolDefinition[] },
): Record<string, unknown> {
  const maxTokens = Math.min(config.maxTokens, 131072);
  const payload: Record<string, unknown> = {
    model: config.model,
    messages: messages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      return msg;
    }),
    max_tokens: maxTokens,
  };

  const thinkingPayload = buildThinkingCapabilityPayload(config);
  if (thinkingPayload) {
    payload.thinking = thinkingPayload;
  }

  if (options?.tools?.length) {
    payload.tools = options.tools;
  }

  if (options?.stream) {
    payload.stream = true;
  }

  return payload;
}

function normalizeResult(
  data: Record<string, unknown>,
  fallbackModel: string,
): LLMResponse {
  const choices = Array.isArray(data.choices)
    ? (data.choices as Array<Record<string, unknown>>)
    : [];
  const msg = (choices[0]?.message ?? null) as Record<string, unknown> | null;
  const assistantContent = extractAssistantContent(msg);
  const thinkingContent = extractThinkingContent(msg);
  const thinkingMarkers = detectProtocolMarkers(thinkingContent);

  if (thinkingContent.trim()) {
    consola.info(
      `[LLM][thinking][normalizeResult] len=${thinkingContent.length} markers=${thinkingMarkers.join(",") || "none"} preview=${JSON.stringify(previewText(thinkingContent))}`,
    );
    if (thinkingMarkers.length > 0) {
      consola.warn(
        `[LLM][thinking][normalizeResult] provider thinking contains protocol markers: ${thinkingMarkers.join(", ")}`,
      );
    }
  }

  /* 提取 tool_calls */
  const rawToolCalls = Array.isArray(msg?.tool_calls) ? (msg.tool_calls as ToolCall[]) : undefined;

  return {
    assistantContent,
    thinkingContent,
    content: assistantContent.trim().length > 0 ? assistantContent : thinkingContent,
    model: typeof data.model === "string" ? data.model : fallbackModel,
    usage: normalizeUsage((data.usage ?? null) as Record<string, unknown> | null),
    toolCalls: rawToolCalls,
    raw: data,
  };
}

function parseSSELine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "data: [DONE]" || !trimmed.startsWith("data: ")) {
    return null;
  }

  try {
    return JSON.parse(trimmed.slice(6)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractDeltaEvent(
  json: Record<string, unknown>,
): { assistantChunk?: string; thinkingChunk?: string; usage?: TokenUsage } {
  const choices = Array.isArray(json.choices)
    ? (json.choices as Array<Record<string, unknown>>)
    : [];
  const choice = choices[0];
  const delta = (choice?.delta ?? choice?.message) as Record<string, unknown> | undefined;
  const assistantChunk = extractAssistantContent(delta);
  const thinkingChunk = extractThinkingContent(delta);
  const thinkingMarkers = detectProtocolMarkers(thinkingChunk);

  if (thinkingChunk) {
    consola.info(
      `[LLM][thinking][stream] len=${thinkingChunk.length} markers=${thinkingMarkers.join(",") || "none"} preview=${JSON.stringify(previewText(thinkingChunk))}`,
    );
    if (thinkingMarkers.length > 0) {
      consola.warn(
        `[LLM][thinking][stream] provider thinking chunk contains protocol markers: ${thinkingMarkers.join(", ")}`,
      );
    }
  }

  return {
    assistantChunk: assistantChunk || undefined,
    thinkingChunk: thinkingChunk || undefined,
    usage: normalizeUsage((json.usage ?? null) as Record<string, unknown> | null),
  };
}

/** OpenAI 兼容协议客户端 */
export class OpenAICompatibleClient implements LLMClient {
  private _config: LLMConfig;

  constructor(config: LLMConfig) {
    this._config = config;
    /* 防止系统 HTTP 代理干扰 LLM 调用：将 baseUrl 的域名加入 NO_PROXY */
    try {
      const host = new URL(config.baseUrl).hostname;
      const existing = process.env.NO_PROXY || process.env.no_proxy || "";
      if (!existing.includes(host)) {
        process.env.NO_PROXY = existing ? `${existing},${host}` : host;
      }
    } catch { /* URL 解析失败时忽略 */ }
  }

  async chat(messages: Message[], options?: { tools?: ToolDefinition[] }): Promise<LLMResponse> {
    const payload = buildChatPayload(this._config, messages, { tools: options?.tools });
    consola.info("LLM 请求", this._config.model, `${messages.length} messages`);
    const start = performance.now();
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const url = `${this._config.baseUrl.replace(/\/$/, "")}/chat/completions`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this._config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this._config.timeout * 1000),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
        }

        const data = (await resp.json()) as Record<string, unknown>;
        const elapsed = (performance.now() - start) / 1000;
        const result = normalizeResult(data, this._config.model);

        consola.info(
          "LLM 响应",
          data.model ?? this._config.model,
          `${elapsed.toFixed(3)}s`,
        );

        return result;
      } catch (e) {
        lastError = e as Error;
        if (attempt < maxRetries - 1) continue;
      }
    }

    throw new Error(
      `LLM 调用失败（重试 ${maxRetries} 次）: ${lastError?.message}`,
    );
  }

  isThinkingEnabled(): boolean {
    return this._config.thinking.enabled;
  }

  preferNonStreamingThinking(): boolean {
    return this._config.thinking.enabled;
  }

  /**
   * 简化调用 —— 传入 prompt，返回纯文本响应
   *
   * 适用于 [program] 中对象调用 LLM 的场景。
   */
  async simpleCall(prompt: string, options?: SimpleLLMOptions): Promise<string> {
    const messages: Message[] = [];
    if (options?.system) {
      messages.push({ role: "system", content: options.system });
    }
    messages.push({ role: "user", content: prompt });

    const response = await this.chat(messages);
    return response.content;
  }

  /**
   * 流式聊天 —— 返回双通道事件
   */
  async *chatEventStream(messages: Message[]): AsyncIterable<LLMStreamEvent> {
    const payload = buildChatPayload(this._config, messages, { stream: true });
    consola.info("LLM 流式请求", this._config.model, `${messages.length} messages`);
    const start = performance.now();
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const url = `${this._config.baseUrl.replace(/\/$/, "")}/chat/completions`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this._config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this._config.timeout * 1000),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
        }

        const reader = resp.body?.getReader();
        if (!reader) throw new Error("响应体为空");

        const decoder = new TextDecoder();
        let buffer = "";
        let lastJson: Record<string, unknown> | null = null;

        /* per-chunk 超时：至少 30s，或 config.timeout 的一半（秒→毫秒） */
        const chunkTimeoutMs = Math.max(30_000, this._config.timeout * 500);

        const emitEvents = async function* (
          parsedJson: Record<string, unknown> | null,
        ): AsyncIterable<LLMStreamEvent> {
          if (!parsedJson) return;
          lastJson = parsedJson;
          const { assistantChunk, thinkingChunk } = extractDeltaEvent(parsedJson);
          if (thinkingChunk) {
            yield { type: "thinking_chunk", chunk: thinkingChunk };
          }
          if (assistantChunk) {
            yield { type: "assistant_chunk", chunk: assistantChunk };
          }
        };

        while (true) {
          const { done, value } = await readWithTimeout(reader, chunkTimeoutMs);
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            for await (const event of emitEvents(parseSSELine(line))) {
              yield event;
            }
          }
        }

        if (buffer.trim()) {
          for await (const event of emitEvents(parseSSELine(buffer))) {
            yield event;
          }
        }

        const elapsed = (performance.now() - start) / 1000;
        const doneUsage = lastJson
          ? normalizeUsage((lastJson["usage"] ?? null) as Record<string, unknown> | null)
          : undefined;
        consola.info("LLM 流式响应完成", this._config.model, `${elapsed.toFixed(3)}s`);
        yield {
          type: "done",
          usage: doneUsage,
          raw: lastJson ?? undefined,
        };
        return;
      } catch (e) {
        lastError = e as Error;
        if (attempt < maxRetries - 1) continue;
      }
    }

    throw new Error(
      `LLM 流式调用失败（重试 ${maxRetries} 次）: ${lastError?.message}`,
    );
  }

  /**
   * 流式聊天 —— 返回 token 异步迭代器
   *
   * 使用 OpenAI 兼容的 stream: true 参数，逐 token 返回。
   * 内部自动重试（与 chat() 一致）。
   */
  async *chatStream(messages: Message[]): AsyncIterable<string> {
    let sawAssistantChunk = false;
    let thinkingBuffer = "";

    for await (const event of this.chatEventStream(messages)) {
      if (event.type === "assistant_chunk") {
        sawAssistantChunk = true;
        yield event.chunk;
      } else if (!sawAssistantChunk && event.type === "thinking_chunk") {
        thinkingBuffer += event.chunk;
      }
    }

    if (!sawAssistantChunk && thinkingBuffer.trim().length > 0) {
      yield thinkingBuffer;
    }
  }
}

/**
 * responseFn 的返回值：
 * - string —— 纯文本内容（不带 tool call）
 * - { content, toolCalls? } —— 支持工具调用 mock 的完整响应
 */
export type MockLLMResponseFnResult =
  | string
  | { content?: string; toolCalls?: ToolCall[]; thinkingContent?: string };

/** 测试用 Mock 客户端 */
export class MockLLMClient implements LLMClient {
  private _responses: string[];
  private _responseObjects: Array<Partial<LLMResult>>;
  private _streamEvents: LLMStreamEvent[] | null;
  private _responseFn: ((messages: Message[]) => MockLLMResponseFnResult) | null;
  private _callCount = 0;
  private _callHistory: Message[][] = [];

  constructor(params?: {
    responses?: string[];
    responseFn?: (messages: Message[]) => MockLLMResponseFnResult;
    responseObject?: Partial<LLMResult>;
    responseObjects?: Array<Partial<LLMResult>>;
    streamEvents?: LLMStreamEvent[];
  }) {
    this._responses = params?.responses ? [...params.responses] : [];
    this._responseObjects = params?.responseObjects
      ? [...params.responseObjects]
      : params?.responseObject
        ? [{ ...params.responseObject }]
        : [];
    this._streamEvents = params?.streamEvents ? [...params.streamEvents] : null;
    this._responseFn = params?.responseFn ?? null;
  }

  async chat(messages: Message[]): Promise<LLMResponse> {
    this._callHistory.push(messages);
    this._callCount++;

    if (this._responseObjects.length > 0) {
      const result = this._responseObjects.shift()!;
      const assistantContent = result.assistantContent ?? "";
      const thinkingContent = result.thinkingContent ?? "";

      return {
        assistantContent,
        thinkingContent,
        content: assistantContent.trim().length > 0 ? assistantContent : thinkingContent,
        model: result.model ?? "mock",
        usage: result.usage ?? {},
        raw: (result.raw as Record<string, unknown> | undefined) ?? {},
      };
    }

    let content: string = "";
    let toolCalls: ToolCall[] | undefined;
    let thinkingContent = "";
    if (this._responseFn) {
      const fnResult = this._responseFn(messages);
      if (typeof fnResult === "string") {
        content = fnResult;
      } else {
        content = fnResult.content ?? "";
        toolCalls = fnResult.toolCalls;
        thinkingContent = fnResult.thinkingContent ?? "";
      }
    } else if (this._responses.length > 0) {
      content = this._responses.shift()!;
    } else {
      content = `[MockLLM 默认响应 #${this._callCount}]`;
    }

    return {
      assistantContent: content,
      thinkingContent,
      content,
      model: "mock",
      usage: {},
      raw: {},
      toolCalls,
    };
  }

  get callCount(): number {
    return this._callCount;
  }
  get callHistory(): Message[][] {
    return this._callHistory;
  }

  isThinkingEnabled(): boolean {
    if (this._responseObjects.some((item) => (item.thinkingContent ?? "").trim().length > 0)) {
      return true;
    }
    if (this._streamEvents?.some((event) => event.type === "thinking_chunk" && event.chunk.trim().length > 0)) {
      return true;
    }
    return false;
  }

  preferNonStreamingThinking(): boolean {
    return false;
  }

  /** Mock 流式输出：将完整响应按字符逐个 yield */
  async *chatStream(messages: Message[]): AsyncIterable<string> {
    let sawAssistant = false;
    let thinkingBuffer = "";

    for await (const event of this.chatEventStream(messages)) {
      if (event.type === "assistant_chunk") {
        sawAssistant = true;
        yield event.chunk;
      } else if (!sawAssistant && event.type === "thinking_chunk") {
        thinkingBuffer += event.chunk;
      }
    }

    if (!sawAssistant && thinkingBuffer) {
      yield thinkingBuffer;
    }
  }

  async *chatEventStream(messages: Message[]): AsyncIterable<LLMStreamEvent> {
    if (this._streamEvents) {
      for (const event of this._streamEvents) {
        yield event;
      }
      if (this._streamEvents[this._streamEvents.length - 1]?.type !== "done") {
        yield { type: "done" };
      }
      return;
    }

    const response = await this.chat(messages);
    const chunkSize = 10;

    if (response.thinkingContent) {
      for (let i = 0; i < response.thinkingContent.length; i += chunkSize) {
        yield {
          type: "thinking_chunk",
          chunk: response.thinkingContent.slice(i, i + chunkSize),
        };
      }
    }

    if (response.assistantContent) {
      for (let i = 0; i < response.assistantContent.length; i += chunkSize) {
        yield {
          type: "assistant_chunk",
          chunk: response.assistantContent.slice(i, i + chunkSize),
        };
      }
    }

    yield { type: "done", usage: response.usage, raw: response.raw };
  }
}
