/**
 * thinkable client / config 测试
 *
 * 仅覆盖 thinking capability 与双通道 LLM 返回结构。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DefaultConfig } from "../src/thinkable/llm/config.js";
import {
  detectProtocolMarkers,
  MockLLMClient,
  OpenAICompatibleClient,
  buildChatPayload,
  type LLMStreamEvent,
} from "../src/thinkable/llm/client.js";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function createSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
}

describe("thinkable config", () => {
  beforeEach(() => {
    restoreEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  test("DefaultConfig 读取 thinking capability 环境变量", () => {
    process.env.OOC_API_KEY = "test-key";
    process.env.OOC_THINKING_ENABLED = "1";
    process.env.OOC_THINKING_MODE = "enabled";
    process.env.OOC_THINKING_BUDGET = "2048";

    const config = DefaultConfig();

    expect(config.thinking).toEqual({
      enabled: true,
      mode: "enabled",
      budget: 2048,
    });
  });
});

describe("thinkable client", () => {
  beforeEach(() => {
    restoreEnv();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  afterEach(() => {
    restoreEnv();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("MockLLMClient.chat 返回 assistant/thinking 双通道结构", async () => {
    const client = new MockLLMClient({
      responseObject: {
        assistantContent: "[finish]",
        thinkingContent: "我已经完成任务。",
      },
    });

    const result = await client.chat([{ role: "user", content: "hi" }]);

    expect(result.assistantContent).toBe("[finish]");
    expect(result.thinkingContent).toBe("我已经完成任务。");
  });

  test("buildChatPayload 包含 thinking capability 映射", () => {
    process.env.OOC_API_KEY = "test-key";
    const config = {
      ...DefaultConfig(),
      apiKey: "test-key",
      thinking: {
        enabled: true,
        mode: "enabled",
        budget: 2048,
      },
    };

    const payload = buildChatPayload(config, [{ role: "user", content: "hi" }]);

    expect(payload).toMatchObject({
      model: config.model,
      messages: [{ role: "user", content: "hi" }],
      thinking: {
        type: "enabled",
        budget: 2048,
      },
    });
  });

  test("仅开启 thinking 语义但未配置 provider 参数时，不注入 thinking payload", () => {
    process.env.OOC_API_KEY = "test-key";
    const config = {
      ...DefaultConfig(),
      apiKey: "test-key",
      thinking: {
        enabled: true,
      },
    };

    const payload = buildChatPayload(config, [{ role: "user", content: "hi" }]);

    expect(payload).not.toHaveProperty("thinking");
  });

  test("detectProtocolMarkers 能识别 thinking 中混入的协议痕迹", () => {
    expect(detectProtocolMarkers("我来分析一下\n```toml\n[program]\ncode = \"\"\"\n")).toEqual([
      "fenced_toml",
      "protocol_section",
    ]);
    expect(detectProtocolMarkers("纯思考内容，不含协议")).toEqual([]);
  });

  test("OpenAICompatibleClient.chat 返回 assistant/thinking 双通道结构", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = ((async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: "test-model",
        choices: [
          {
            message: {
              content: "[finish]",
              reasoning_content: "先思考，再完成。",
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      }));
    }) as unknown) as typeof fetch;

    const client = new OpenAICompatibleClient({
      provider: "openai-compatible",
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "test-model",
      maxTokens: 1024,
      timeout: 5,
      thinking: {
        enabled: true,
        mode: "enabled",
        budget: 2048,
      },
    });

    const result = await client.chat([{ role: "user", content: "hi" }]);

    expect(capturedBody).toMatchObject({
      thinking: {
        type: "enabled",
        budget: 2048,
      },
    });
    expect(result.assistantContent).toBe("[finish]");
    expect(result.thinkingContent).toBe("先思考，再完成。");
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  test("OpenAICompatibleClient.chatEventStream 可区分 assistant/thinking 事件", async () => {
    globalThis.fetch = ((async () => {
      return new Response(createSSEStream([
        'data: {"choices":[{"delta":{"reasoning_content":"先分析"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"[finish]"}}]}\n\n',
        "data: [DONE]\n\n",
      ]));
    }) as unknown) as typeof fetch;

    const client = new OpenAICompatibleClient({
      provider: "openai-compatible",
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "test-model",
      maxTokens: 1024,
      timeout: 5,
      thinking: {
        enabled: true,
        mode: "enabled",
        budget: 1024,
      },
    });

    const events: LLMStreamEvent[] = [];
    for await (const event of client.chatEventStream([{ role: "user", content: "hi" }])) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "thinking_chunk", chunk: "先分析" });
    expect(events[1]).toEqual({ type: "assistant_chunk", chunk: "[finish]" });
    expect(events[2]?.type).toBe("done");
  });
});
