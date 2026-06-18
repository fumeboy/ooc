import { describe, expect, it, mock } from "bun:test";
import { createLlmClient } from "../client.ts";

describe("createLlmClient", () => {
  it("generate 返回统一的 toolCalls 数组", async () => {
    process.env.OOC_PROVIDER = "openai";
    process.env.OOC_API_KEY = "test-key";
    process.env.OOC_BASE_URL = "https://example.com/v1";
    process.env.OOC_MODEL = "gpt-test";

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "准备调用工具" }]
            },
            {
              type: "function_call",
              call_id: "call_1",
              name: "wait",
              arguments: "{\"reason\":\"need input\"}"
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const client = createLlmClient();
    const result = await client.generate({
      input: [{ type: "message", role: "user", content: "hi" }],
      tools: [
        {
          name: "wait",
          description: "等待外部输入",
          inputSchema: {
            type: "object",
            properties: {
              reason: { type: "string" }
            },
            required: ["reason"]
          }
        }
      ]
    });

    expect(result.text).toBe("准备调用工具");
    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        name: "wait",
        arguments: { reason: "need input" }
      }
    ]);
  });

  it("默认使用环境变量中的 provider", async () => {
    process.env.OOC_PROVIDER = "openai";
    process.env.OOC_API_KEY = "test-key";
    process.env.OOC_BASE_URL = "https://example.com/v1";
    process.env.OOC_MODEL = "gpt-test";

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "hello from client" }]
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const client = createLlmClient();
    const result = await client.generate({
      input: [{ type: "message", role: "user", content: "hi" }]
    });

    expect(result.provider).toBe("openai");
    expect(result.text).toBe("hello from client");
    expect(result.toolCalls).toEqual([]);
  });

  it("调用参数可以覆盖默认 provider", async () => {
    process.env.OOC_PROVIDER = "openai";
    process.env.OOC_API_KEY = "test-key";
    process.env.OOC_BASE_URL = "https://example.com";
    process.env.OOC_MODEL = "claude-test";

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hello from override" }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const client = createLlmClient();
    const result = await client.generate({
      provider: "claude",
      input: [{ type: "message", role: "user", content: "hi" }]
    });

    expect(result.provider).toBe("claude");
    expect(result.text).toBe("hello from override");
    expect(result.toolCalls).toEqual([]);
  });
});
