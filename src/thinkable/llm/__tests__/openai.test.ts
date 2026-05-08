import { describe, expect, it, mock } from "bun:test";
import { generateWithOpenAi, streamWithOpenAi } from "../providers/openai.ts";

describe("openai provider", () => {
  it("解析非流式文本结果", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello from openai" } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const result = await generateWithOpenAi(
      {
        provider: "openai",
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        model: "gpt-test"
      },
      { messages: [{ role: "user", content: "hi" }] }
    );

    expect(result.text).toBe("hello from openai");
  });

  it("把流式响应归一化为统一事件", async () => {
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

    const events = [];

    for await (const event of streamWithOpenAi(
      {
        provider: "openai",
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        model: "gpt-test"
      },
      { messages: [{ role: "user", content: "hi" }] }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "start", provider: "openai", model: "gpt-test" },
      { type: "text-delta", text: "hel" },
      { type: "text-delta", text: "lo" },
      { type: "done", text: "hello", raw: undefined }
    ]);
  });

  it("非 2xx 状态码时抛错", async () => {
    globalThis.fetch = mock(async () => new Response("bad request", { status: 400 })) as unknown as typeof fetch;

    expect(
      generateWithOpenAi(
        {
          provider: "openai",
          apiKey: "test-key",
          baseUrl: "https://example.com/v1",
          model: "gpt-test"
        },
        { messages: [{ role: "user", content: "hi" }] }
      )
    ).rejects.toThrow("OpenAI 请求失败");
  });
});
