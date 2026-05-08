import { describe, expect, it, mock } from "bun:test";
import { createLlmClient } from "../client.ts";

describe("createLlmClient", () => {
  it("默认使用环境变量中的 provider", async () => {
    process.env.OOC_PROVIDER = "openai";
    process.env.OOC_API_KEY = "test-key";
    process.env.OOC_BASE_URL = "https://example.com/v1";
    process.env.OOC_MODEL = "gpt-test";

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello from client" } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const client = createLlmClient();
    const result = await client.generate({
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result.provider).toBe("openai");
    expect(result.text).toBe("hello from client");
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
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result.provider).toBe("claude");
    expect(result.text).toBe("hello from override");
  });

  it("stream 返回统一事件序列", async () => {
    process.env.OOC_PROVIDER = "openai";
    process.env.OOC_API_KEY = "test-key";
    process.env.OOC_BASE_URL = "https://example.com/v1";
    process.env.OOC_MODEL = "gpt-test";

    const body = [
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      "data: [DONE]\n\n"
    ].join("");

    globalThis.fetch = mock(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    ) as unknown as typeof fetch;

    const client = createLlmClient();
    const events = [];

    for await (const event of client.stream({
      messages: [{ role: "user", content: "hi" }]
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "start", provider: "openai", model: "gpt-test" },
      { type: "text-delta", text: "hel" },
      { type: "text-delta", text: "lo" },
      { type: "done", text: "hello", raw: undefined }
    ]);
  });
});
