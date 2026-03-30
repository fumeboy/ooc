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

/** 聊天消息 */
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/** LLM 响应 */
export interface LLMResponse {
  content: string;
  model: string;
  usage: Record<string, number>;
  raw: Record<string, unknown>;
}

/** simpleCall 简化调用选项 */
export interface SimpleLLMOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

/** LLM 客户端接口 */
export interface LLMClient {
  chat(messages: Message[]): Promise<LLMResponse>;
  /** 流式聊天，返回 token 异步迭代器。不支持时 fallback 到 chat() */
  chatStream?(messages: Message[]): AsyncIterable<string>;
  /** 简化调用：传入 prompt 返回文本 */
  simpleCall?(prompt: string, options?: SimpleLLMOptions): Promise<string>;
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

  async chat(messages: Message[]): Promise<LLMResponse> {
    const maxTokens = Math.min(this._config.maxTokens, 131072);
    const payload = {
      model: this._config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
    };
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

        const data = (await resp.json()) as Record<string, any>;
        const msg = data.choices?.[0]?.message as Record<string, any> | undefined;
        const content = (msg?.content as string | undefined) ?? "";
        const reasoningContent = (msg?.reasoning_content as string | undefined) ?? "";
        const finalContent = content.trim().length > 0 ? content : reasoningContent;
        const elapsed = (performance.now() - start) / 1000;
        const usage = (data.usage ?? {}) as Record<string, number>;

        consola.info(
          "LLM 响应",
          data.model ?? this._config.model,
          `${elapsed.toFixed(3)}s`,
        );

        return {
          content: finalContent,
          model: (data.model as string) ?? this._config.model,
          usage,
          raw: data,
        };
      } catch (e) {
        lastError = e as Error;
        if (attempt < maxRetries - 1) continue;
      }
    }

    throw new Error(
      `LLM 调用失败（重试 ${maxRetries} 次）: ${lastError?.message}`,
    );
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
   * 流式聊天 —— 返回 token 异步迭代器
   *
   * 使用 OpenAI 兼容的 stream: true 参数，逐 token 返回。
   * 内部自动重试（与 chat() 一致）。
   */
  async *chatStream(messages: Message[]): AsyncIterable<string> {
    const maxTokens = Math.min(this._config.maxTokens, 131072);
    const payload = {
      model: this._config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: maxTokens,
      stream: true,
    };
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
        let sawContent = false;
        let reasoningBuffer = "";

        /* per-chunk 超时：至少 30s，或 config.timeout 的一半（秒→毫秒） */
        const chunkTimeoutMs = Math.max(30_000, this._config.timeout * 500);

        while (true) {
          const { done, value } = await readWithTimeout(reader, chunkTimeoutMs);
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          /* 最后一行可能不完整，保留在 buffer 中 */
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;
            if (!trimmed.startsWith("data: ")) continue;

            try {
              const json = JSON.parse(trimmed.slice(6)) as Record<string, any>;
              const delta = json.choices?.[0]?.delta as Record<string, any> | undefined;
              const deltaContent = delta?.content;
              const deltaReasoning = delta?.reasoning_content;

              if (typeof deltaContent === "string" && deltaContent.length > 0) {
                sawContent = true;
                yield deltaContent;
              } else if (!sawContent && typeof deltaReasoning === "string" && deltaReasoning.length > 0) {
                reasoningBuffer += deltaReasoning;
              }
            } catch {
              /* 忽略解析失败的行（可能是不完整的 JSON） */
            }
          }
        }

        /* 处理 buffer 中剩余的数据 */
        if (buffer.trim() && buffer.trim() !== "data: [DONE]" && buffer.trim().startsWith("data: ")) {
          try {
            const json = JSON.parse(buffer.trim().slice(6)) as Record<string, any>;
            const delta = json.choices?.[0]?.delta as Record<string, any> | undefined;
            const deltaContent = delta?.content;
            const deltaReasoning = delta?.reasoning_content;

            if (typeof deltaContent === "string" && deltaContent.length > 0) {
              sawContent = true;
              yield deltaContent;
            } else if (!sawContent && typeof deltaReasoning === "string" && deltaReasoning.length > 0) {
              reasoningBuffer += deltaReasoning;
            }
          } catch { /* 忽略 */ }
        }

        if (!sawContent) {
          const response = await this.chat(messages);
          if (response.content && response.content.trim().length > 0) {
            yield response.content;
          } else if (reasoningBuffer.trim().length > 0) {
            yield reasoningBuffer;
          }
        }

        const elapsed = (performance.now() - start) / 1000;
        consola.info("LLM 流式响应完成", this._config.model, `${elapsed.toFixed(3)}s`);
        return; /* 成功，退出重试循环 */
      } catch (e) {
        lastError = e as Error;
        if (attempt < maxRetries - 1) continue;
      }
    }

    throw new Error(
      `LLM 流式调用失败（重试 ${maxRetries} 次）: ${lastError?.message}`,
    );
  }
}

/** 测试用 Mock 客户端 */
export class MockLLMClient implements LLMClient {
  private _responses: string[];
  private _responseFn: ((messages: Message[]) => string) | null;
  private _callCount = 0;
  private _callHistory: Message[][] = [];

  constructor(params?: {
    responses?: string[];
    responseFn?: (messages: Message[]) => string;
  }) {
    this._responses = params?.responses ? [...params.responses] : [];
    this._responseFn = params?.responseFn ?? null;
  }

  async chat(messages: Message[]): Promise<LLMResponse> {
    this._callHistory.push(messages);
    this._callCount++;

    let content: string;
    if (this._responseFn) {
      content = this._responseFn(messages);
    } else if (this._responses.length > 0) {
      content = this._responses.shift()!;
    } else {
      content = `[MockLLM 默认响应 #${this._callCount}]`;
    }

    return { content, model: "mock", usage: {}, raw: {} };
  }

  get callCount(): number {
    return this._callCount;
  }
  get callHistory(): Message[][] {
    return this._callHistory;
  }

  /** Mock 流式输出：将完整响应按字符逐个 yield */
  async *chatStream(messages: Message[]): AsyncIterable<string> {
    const response = await this.chat(messages);
    /* 模拟流式：每次 yield 一小段文本 */
    const content = response.content;
    const chunkSize = 10;
    for (let i = 0; i < content.length; i += chunkSize) {
      yield content.slice(i, i + chunkSize);
    }
  }
}
