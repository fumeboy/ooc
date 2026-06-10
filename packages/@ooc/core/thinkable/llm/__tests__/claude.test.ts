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
              name: "exec",
              input: { title: "README", class: "file" }
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
        input: [{ type: "message", role: "user", content: "hi" }],
        tools: [
          {
            name: "exec",
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
        name: "exec",
        arguments: { title: "README", class: "file" }
      }
    ]);
    expect(result.outputItems).toEqual([
      {
        type: "message",
        role: "assistant",
        content: "准备处理"
      },
      {
        type: "function_call",
        call_id: "toolu_1",
        name: "exec",
        arguments: { title: "README", class: "file" }
      }
    ]);
  });

  it("input 中无非 system message 时，messages 兜底为一条 placeholder user 消息", async () => {
    // 真实场景：OOC 把 inbox_message_arrived / inject 全部映射为 role=system，
    // 经 toClaudeMessages 过滤后 messages 数组为空。Anthropic 官方 API 会 400；
    // 个别代理会 200 + 空 body 让 retry 也无效。
    // 适配器边界补一条 placeholder user message，保住协议契约。
    let capturedBody: any;
    globalThis.fetch = mock(async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    await generateWithClaude(
      {
        provider: "claude",
        apiKey: "test-key",
        baseUrl: "https://example.com",
        model: "claude-test"
      },
      { input: [{ type: "message", role: "system", content: "<context>...</context>" }] }
    );

    expect(Array.isArray(capturedBody.messages)).toBe(true);
    expect(capturedBody.messages.length).toBe(1);
    expect(capturedBody.messages[0].role).toBe("user");
    expect(typeof capturedBody.messages[0].content).toBe("string");
    expect(capturedBody.messages[0].content.length).toBeGreaterThan(0);
  });

  it("inbox_message_arrived 标记的 system 消息被抽到 messages 作为 user 文本", async () => {
    // OOC processEventToItems 把 inbox 渲染成 role=system + 特殊前缀。
    // Claude transport 识别该前缀，把"真实正文"抽出来作 user 文本块，让 Claude
    // 看到对话起点，不需要 Continue 兜底。
    let capturedBody: any;
    globalThis.fetch = mock(async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    await generateWithClaude(
      {
        provider: "claude",
        apiKey: "test-key",
        baseUrl: "https://example.com",
        model: "claude-test",
      },
      {
        input: [
          { type: "message", role: "system", content: "<context>...</context>" },
          {
            type: "message",
            role: "system",
            content: "[context_change:inbox_message_arrived] msg_id=m1 source=user from=user\n请帮我数文件",
          },
        ],
      },
    );

    expect(capturedBody.messages.length).toBe(1);
    expect(capturedBody.messages[0].role).toBe("user");
    expect(Array.isArray(capturedBody.messages[0].content)).toBe(true);
    expect(capturedBody.messages[0].content[0]).toEqual({
      type: "text",
      text: "请帮我数文件",
    });
    // <context>...</context> 仍然进 system 字段
    expect(capturedBody.system).toContain("<context>");
    // 不应在 system 里出现 inbox 标记原文
    expect(capturedBody.system).not.toContain("[context_change:inbox_message_arrived]");
  });

  it("function_call 转 assistant tool_use 块、function_call_output 转 user tool_result 块", async () => {
    let capturedBody: any;
    globalThis.fetch = mock(async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    await generateWithClaude(
      {
        provider: "claude",
        apiKey: "test-key",
        baseUrl: "https://example.com",
        model: "claude-test",
      },
      {
        input: [
          {
            type: "message",
            role: "system",
            content: "[context_change:inbox_message_arrived] msg_id=m1 source=user from=user window_id=w_talk\nhi",
          },
          {
            type: "function_call",
            call_id: "tooluse_1",
            name: "exec",
            arguments: { method: "talk", title: "say hi" },
          },
          {
            type: "function_call_output",
            call_id: "tooluse_1",
            name: "exec",
            output: '{"ok":true}',
          },
          {
            type: "function_call",
            call_id: "tooluse_2",
            name: "wait",
            arguments: { on: "w_creator" },
          },
        ],
      },
    );

    // 期望：user(text:hi) → assistant(tool_use:open) → user(tool_result) → assistant(tool_use:wait)
    expect(capturedBody.messages.length).toBe(4);
    expect(capturedBody.messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "hi" }],
    });
    expect(capturedBody.messages[1].role).toBe("assistant");
    expect(capturedBody.messages[1].content[0]).toEqual({
      type: "tool_use",
      id: "tooluse_1",
      name: "exec",
      input: { method: "talk", title: "say hi" },
    });
    expect(capturedBody.messages[2].role).toBe("user");
    expect(capturedBody.messages[2].content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "tooluse_1",
      content: '{"ok":true}',
    });
    expect(capturedBody.messages[3].role).toBe("assistant");
    expect(capturedBody.messages[3].content[0].type).toBe("tool_use");
    expect(capturedBody.messages[3].content[0].name).toBe("wait");
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
      { input: [{ type: "message", role: "user", content: "hi" }] }
    );

    expect(result.text).toBe("hello from claude");
    expect(result.outputItems).toEqual([
      {
        type: "message",
        role: "assistant",
        content: "hello from claude"
      }
    ]);
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
      { input: [{ type: "message", role: "user", content: "hi" }] }
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
        input: [{ type: "message", role: "user", content: "hi" }],
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
      { input: [{ type: "message", role: "user", content: "hi" }] }
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

  it("非合法 JSON 响应会按重试策略重试后成功", async () => {
    let attempts = 0;
    globalThis.fetch = mock(async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "retry ok" }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const result = await generateWithClaude(
      {
        provider: "claude",
        apiKey: "test-key",
        baseUrl: "https://example.com",
        model: "claude-test"
      },
      { input: [{ type: "message", role: "user", content: "hi" }] }
    );

    expect(attempts).toBe(3);
    expect(result.text).toBe("retry ok");
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
        { input: [{ type: "message", role: "user", content: "hi" }] }
      )
    ).rejects.toThrow("Claude 请求失败");
  });
});
