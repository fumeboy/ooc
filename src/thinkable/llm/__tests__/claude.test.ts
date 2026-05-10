import { describe, expect, it, mock } from "bun:test";
import { generateWithClaude, streamWithClaude } from "../providers/claude.ts";

describe("claude provider", () => {
  it("解析非流式 tool call 结果", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          content: [
            { type: "text", text: "准备处理" },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "open",
              input: { title: "README", type: "file" }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const result = await generateWithClaude(
      {
        provider: "claude",
        apiKey: "test-key",
        baseUrl: "https://example.com",
        model: "claude-test"
      },
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            name: "open",
            description: "打开资源",
            inputSchema: { type: "object" }
          }
        ]
      }
    );

    expect(result.text).toBe("准备处理");
    expect(result.toolCalls).toEqual([
      {
        id: "toolu_1",
        name: "open",
        arguments: { title: "README", type: "file" }
      }
    ]);
  });

  it("解析非流式文本结果", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hello from claude" }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const result = await generateWithClaude(
      {
        provider: "claude",
        apiKey: "test-key",
        baseUrl: "https://example.com",
        model: "claude-test"
      },
      { messages: [{ role: "user", content: "hi" }] }
    );

    expect(result.text).toBe("hello from claude");
  });

  it("把 Claude 流事件归一化为统一事件", async () => {
    const body = [
      "event: content_block_delta\n",
      'data: {"delta":{"type":"text_delta","text":"hel"}}\n\n',
      "event: content_block_delta\n",
      'data: {"delta":{"type":"text_delta","text":"lo"}}\n\n'
    ].join("");

    globalThis.fetch = mock(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    ) as unknown as typeof fetch;

    const events = [];

    for await (const event of streamWithClaude(
      {
        provider: "claude",
        apiKey: "test-key",
        baseUrl: "https://example.com",
        model: "claude-test"
      },
      { messages: [{ role: "user", content: "hi" }] }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "start", provider: "claude", model: "claude-test" },
      { type: "text-delta", text: "hel" },
      { type: "text-delta", text: "lo" },
      { type: "done", text: "hello", toolCalls: [], raw: undefined }
    ]);
  });

  it("把 Claude 流式 tool call 归一化为统一事件", async () => {
    const body = [
      "event: content_block_start\n",
      'data: {"content_block":{"type":"tool_use","id":"toolu_1","name":"close","input":{"reason":"done"}}}\n\n'
    ].join("");

    globalThis.fetch = mock(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    ) as unknown as typeof fetch;

    const events = [];

    for await (const event of streamWithClaude(
      {
        provider: "claude",
        apiKey: "test-key",
        baseUrl: "https://example.com",
        model: "claude-test"
      },
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            name: "close",
            description: "关闭当前任务",
            inputSchema: { type: "object" }
          }
        ]
      }
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "start", provider: "claude", model: "claude-test" },
      {
        type: "tool-call",
        toolCall: {
          id: "toolu_1",
          name: "close",
          arguments: { reason: "done" }
        }
      },
      {
        type: "done",
        text: "",
        toolCalls: [
          {
            id: "toolu_1",
            name: "close",
            arguments: { reason: "done" }
          }
        ],
        raw: undefined
      }
    ]);
  });

  it("代理只返回 SSE 时 generateWithClaude 自动聚合", async () => {
    // 模拟 claudeide 类型代理：忽略 stream:false，永远返回 text/event-stream
    const body = [
      "event: content_block_delta\n",
      'data: {"index":0,"delta":{"type":"text_delta","text":"hi "}}\n\n',
      "event: content_block_delta\n",
      'data: {"index":0,"delta":{"type":"text_delta","text":"there"}}\n\n',
      "event: content_block_start\n",
      'data: {"index":1,"content_block":{"type":"tool_use","id":"toolu_x","name":"wait","input":{}}}\n\n',
      "event: content_block_delta\n",
      'data: {"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"reason\\":"}}\n\n',
      "event: content_block_delta\n",
      'data: {"index":1,"delta":{"type":"input_json_delta","partial_json":"\\"等用户\\"}"}}\n\n',
      "event: content_block_stop\n",
      'data: {"index":1}\n\n'
    ].join("");

    globalThis.fetch = mock(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    ) as unknown as typeof fetch;

    const result = await generateWithClaude(
      {
        provider: "claude",
        apiKey: "test-key",
        baseUrl: "https://example.com",
        model: "claude-test"
      },
      { messages: [{ role: "user", content: "hi" }] }
    );

    expect(result.text).toBe("hi there");
    expect(result.toolCalls).toEqual([
      {
        id: "toolu_x",
        name: "wait",
        arguments: { reason: "等用户" }
      }
    ]);
  });

  it("Claude 非 2xx 状态码时抛错", async () => {
    globalThis.fetch = mock(async () => new Response("bad request", { status: 401 })) as unknown as typeof fetch;

    expect(
      generateWithClaude(
        {
          provider: "claude",
          apiKey: "test-key",
          baseUrl: "https://example.com",
          model: "claude-test"
        },
        { messages: [{ role: "user", content: "hi" }] }
      )
    ).rejects.toThrow("Claude 请求失败");
  });
});
