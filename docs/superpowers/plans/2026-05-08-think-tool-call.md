# Think Tool Call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展现有 `thinkable/llm` 以支持原生 tool call，并新增 `think(thread, llmClient)` 单轮执行骨架与占位模块。

**Architecture:** 保留现有 `generate()` / `stream()` 入口，只升级它们的统一返回结构与 provider 适配逻辑；`think` 直接调用 `buildContext`、`getAvailableTools`、`observable` 占位函数和 `llmClient.generate()`，不引入额外 orchestration 层。新的 `context.ts`、`tools.ts`、`observable/index.ts` 只提供最小占位实现，保证编译、测试和文档引用关系先成立。

**Tech Stack:** Bun, TypeScript, Bun test, Fetch API, OpenAI chat completions, Claude messages API

---

## File Map

### New Files

- Create: `src/executable/tools.ts`
- Create: `src/observable/index.ts`
- Create: `src/thinkable/context.ts`
- Create: `src/thinkable/thinkloop.ts`
- Create: `src/thinkable/__tests__/thinkloop.test.ts`

### Modified Files

- Modify: `src/thinkable/llm/types.ts`
- Modify: `src/thinkable/llm/client.ts`
- Modify: `src/thinkable/llm/providers/openai.ts`
- Modify: `src/thinkable/llm/providers/claude.ts`
- Modify: `src/thinkable/llm/index.ts`
- Modify: `src/thinkable/llm/__tests__/openai.test.ts`
- Modify: `src/thinkable/llm/__tests__/claude.test.ts`
- Modify: `src/thinkable/llm/__tests__/client.test.ts`
- Modify: `src/thinkable/llm/__tests__/real-openai.test.ts`
- Modify: `meta/object/thinkable/llm/index.doc.js`
- Modify: `meta/object/thinkable/thinkloop/index.doc.js`

## Task 1: 升级 `llm` 类型契约

**Files:**
- Modify: `src/thinkable/llm/types.ts`
- Test: `src/thinkable/llm/__tests__/client.test.ts`

- [ ] **Step 1: 写出会失败的 client 测试，先声明 tool call 结果结构**

```ts
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
          choices: [
            {
              message: {
                content: "准备调用工具",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "wait",
                      arguments: "{\"reason\":\"need input\"}"
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const client = createLlmClient();
    const result = await client.generate({
      messages: [{ role: "user", content: "hi" }],
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
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/thinkable/llm/__tests__/client.test.ts -t "generate 返回统一的 toolCalls 数组"`
Expected: FAIL，提示 `tools` 或 `toolCalls` 不存在

- [ ] **Step 3: 修改 `types.ts`，加入 tool call 相关统一类型**

```ts
// LLM provider 只保留首批需要的两种协议，避免过早抽象。
export type LlmProvider = "openai" | "claude";

// thinkloop 当前文档只定义了 5 个 tool，这里不提前开放任意字符串。
export type LlmToolName = "open" | "refine" | "submit" | "close" | "wait";

// 统一消息结构先只支持纯文本，后续再扩展多模态。
export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// tool 定义直接给 provider 使用，不额外引入复杂 schema 框架。
export type LlmTool = {
  name: LlmToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

// 统一 tool call 结果，供 thinkloop 直接消费。
export type LlmToolCall = {
  id: string;
  name: LlmToolName;
  arguments: Record<string, unknown>;
};

// 统一请求参数由上层传入，provider 与 model 允许按次覆盖默认值。
export type LlmGenerateParams = {
  provider?: LlmProvider;
  model?: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  temperature?: number;
  maxTokens?: number;
};

// 非流式结果保留文本、toolCalls 与调试字段，避免拆成第三种入口。
export type LlmGenerateResult = {
  provider: LlmProvider;
  model: string;
  text: string;
  toolCalls: LlmToolCall[];
  thinking?: string;
  raw?: unknown;
};

// 流式事件统一成开始、thinking、文本、tool-call 与结束五类事件。
export type LlmStreamEvent =
  | { type: "start"; provider: LlmProvider; model: string }
  | { type: "thinking-delta"; text: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCall: LlmToolCall }
  | {
      type: "done";
      text: string;
      toolCalls: LlmToolCall[];
      thinking?: string;
      raw?: unknown;
    };

// 运行时环境变量会被解析为标准配置，供 client 和 provider 共用。
export type LlmEnvConfig = {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
};

// 统一门面的最小接口只暴露 generate 与 stream。
export interface LlmClient {
  generate(params: LlmGenerateParams): Promise<LlmGenerateResult>;
  stream(params: LlmGenerateParams): AsyncIterable<LlmStreamEvent>;
}
```

- [ ] **Step 4: 运行测试确认类型契约可编译**

Run: `bun test src/thinkable/llm/__tests__/client.test.ts -t "generate 返回统一的 toolCalls 数组"`
Expected: FAIL，但错误从“类型不存在”变成“provider 尚未返回 toolCalls”

- [ ] **Step 5: 提交类型升级**

```bash
git add src/thinkable/llm/types.ts src/thinkable/llm/__tests__/client.test.ts
git commit -m "refactor: extend llm types for tool calls"
```

## Task 2: 实现 OpenAI provider 的原生 tool call 支持

**Files:**
- Modify: `src/thinkable/llm/providers/openai.ts`
- Modify: `src/thinkable/llm/__tests__/openai.test.ts`

- [ ] **Step 1: 写出 OpenAI 非流式 tool call 失败测试**

```ts
import { describe, expect, it, mock } from "bun:test";
import { generateWithOpenAi, streamWithOpenAi } from "../providers/openai.ts";

describe("openai provider", () => {
  it("解析非流式 tool call 结果", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "开始执行",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "submit",
                      arguments: "{\"command\":\"plan\"}"
                    }
                  }
                ]
              }
            }
          ]
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
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            name: "submit",
            description: "提交命令",
            inputSchema: {
              type: "object",
              properties: {
                command: { type: "string" }
              },
              required: ["command"]
            }
          }
        ]
      }
    );

    expect(result.text).toBe("开始执行");
    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        name: "submit",
        arguments: { command: "plan" }
      }
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/thinkable/llm/__tests__/openai.test.ts -t "解析非流式 tool call 结果"`
Expected: FAIL，当前返回没有 `toolCalls`

- [ ] **Step 3: 修改 OpenAI provider，支持非流式 tool call 提取**

```ts
import type {
  LlmEnvConfig,
  LlmGenerateParams,
  LlmGenerateResult,
  LlmStreamEvent,
  LlmTool,
  LlmToolCall
} from "../types";

// OpenAI tools 统一映射为 function calling 结构。
function toOpenAiTools(tools: LlmTool[] | undefined) {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
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
      arguments: JSON.parse(rawArguments)
    };
  });
}

// OpenAI 非流式请求直接走 chat completions，并返回统一结果。
export async function generateWithOpenAi(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): Promise<LlmGenerateResult> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: params.model ?? config.model,
      messages: params.messages,
      tools: toOpenAiTools(params.tools),
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: false
    })
  });

  // HTTP 层失败时直接抛错，不做额外兜底分支。
  if (!response.ok) {
    throw new Error(`OpenAI 请求失败: ${response.status}`);
  }

  // 非流式路径同时提取文本与 tool call，供 thinkloop 直接消费。
  const raw = await response.json();
  const message = raw.choices?.[0]?.message ?? {};
  const text = message.content ?? "";
  const toolCalls = toOpenAiToolCalls(message.tool_calls);

  return {
    provider: "openai",
    model: params.model ?? config.model,
    text,
    toolCalls,
    raw
  };
}

// OpenAI 流式路径把 SSE 增量归一化成统一事件。
export async function* streamWithOpenAi(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): AsyncIterable<LlmStreamEvent> {
  const model = params.model ?? config.model;
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: params.messages,
      tools: toOpenAiTools(params.tools),
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: true
    })
  });

  // 流式请求需要同时确保状态码成功且存在响应体。
  if (!response.ok || !response.body) {
    throw new Error(`OpenAI 流式请求失败: ${response.status}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let pending = "";
  let fullText = "";
  const toolCallBuffer = new Map<number, { id: string; name: string; arguments: string }>();
  const emittedToolCalls: LlmToolCall[] = [];

  // 统一事件流总是先告诉上层本次请求已经开始。
  yield { type: "start", provider: "openai", model };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    // SSE 可能分片到多个 chunk，需要先拼接再按帧切分。
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split("\n\n");
    pending = frames.pop() ?? "";

    for (const frame of frames) {
      if (!frame.startsWith("data: ")) {
        continue;
      }

      const payload = frame.slice(6);
      if (payload === "[DONE]") {
        continue;
      }

      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta ?? {};
      const textDelta = delta.content ?? "";

      if (textDelta) {
        fullText += textDelta;
        yield { type: "text-delta", text: textDelta };
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const rawToolCall of delta.tool_calls) {
          const index = rawToolCall.index ?? 0;
          const previous = toolCallBuffer.get(index) ?? { id: "", name: "", arguments: "" };
          const next = {
            id: rawToolCall.id ?? previous.id,
            name: rawToolCall.function?.name ?? previous.name,
            arguments: previous.arguments + (rawToolCall.function?.arguments ?? "")
          };

          toolCallBuffer.set(index, next);
        }
      }
    }
  }

  for (const toolCall of [...toolCallBuffer.values()]) {
    const normalized = {
      id: toolCall.id,
      name: toolCall.name as LlmToolCall["name"],
      arguments: JSON.parse(toolCall.arguments || "{}")
    };

    emittedToolCalls.push(normalized);
    yield { type: "tool-call", toolCall: normalized };
  }

  // done 事件把完整文本和 tool call 交给上层，避免上层自行再聚合一遍。
  yield { type: "done", text: fullText, toolCalls: emittedToolCalls, raw: undefined };
}
```

- [ ] **Step 4: 补充 OpenAI 流式 tool call 测试**

```ts
it("把流式 tool call 归一化为统一事件", async () => {
  const body = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"wait","arguments":"{\\"reason\\":\\""}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"more input\\"}"}}]}}]}\n\n',
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
    {
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "wait",
          description: "等待输入",
          inputSchema: { type: "object" }
        }
      ]
    }
  )) {
    events.push(event);
  }

  expect(events).toEqual([
    { type: "start", provider: "openai", model: "gpt-test" },
    {
      type: "tool-call",
      toolCall: {
        id: "call_1",
        name: "wait",
        arguments: { reason: "more input" }
      }
    },
    {
      type: "done",
      text: "",
      toolCalls: [
        {
          id: "call_1",
          name: "wait",
          arguments: { reason: "more input" }
        }
      ],
      raw: undefined
    }
  ]);
});
```

- [ ] **Step 5: 运行 OpenAI provider 全部测试**

Run: `bun test src/thinkable/llm/__tests__/openai.test.ts`
Expected: PASS，文本与 tool call 两组测试都通过

- [ ] **Step 6: 提交 OpenAI provider 改动**

```bash
git add src/thinkable/llm/providers/openai.ts src/thinkable/llm/__tests__/openai.test.ts
git commit -m "feat: add openai tool call support"
```

## Task 3: 实现 Claude provider 的原生 tool call 支持

**Files:**
- Modify: `src/thinkable/llm/providers/claude.ts`
- Modify: `src/thinkable/llm/__tests__/claude.test.ts`

- [ ] **Step 1: 写出 Claude 非流式 tool call 失败测试**

```ts
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
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/thinkable/llm/__tests__/claude.test.ts -t "解析非流式 tool call 结果"`
Expected: FAIL，当前返回没有 `toolCalls`

- [ ] **Step 3: 修改 Claude provider，支持文本与 tool call 统一提取**

```ts
import type {
  LlmEnvConfig,
  LlmGenerateParams,
  LlmGenerateResult,
  LlmMessage,
  LlmStreamEvent,
  LlmTool,
  LlmToolCall
} from "../types";

// Claude 只接受 user / assistant messages，system 单独提取成顶层字段。
function toClaudeMessages(messages: LlmMessage[]) {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

// Claude 的 system 需要从统一 messages 中单独提取。
function toClaudeSystem(messages: LlmMessage[]) {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
}

// Claude tools 可以直接按统一结构映射过去。
function toClaudeTools(tools: LlmTool[] | undefined) {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }));
}

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

// Claude 非流式请求把 content 数组中的文本和 tool call 拼成统一结果。
export async function generateWithClaude(
  config: LlmEnvConfig,
  params: LlmGenerateParams
): Promise<LlmGenerateResult> {
  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: params.model ?? config.model,
      system: toClaudeSystem(params.messages),
      messages: toClaudeMessages(params.messages),
      tools: toClaudeTools(params.tools),
      temperature: params.temperature,
      max_tokens: params.maxTokens ?? 1024,
      stream: false
    })
  });

  // Claude HTTP 失败时直接抛错，让上层决定如何处理。
  if (!response.ok) {
    throw new Error(`Claude 请求失败: ${response.status}`);
  }

  const raw = await response.json();
  const text = (raw.content ?? [])
    .filter((item: { type?: string }) => item.type === "text")
    .map((item: { text?: string }) => item.text ?? "")
    .join("");
  const toolCalls = toClaudeToolCalls(raw.content);

  return {
    provider: "claude",
    model: params.model ?? config.model,
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
  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      system: toClaudeSystem(params.messages),
      messages: toClaudeMessages(params.messages),
      tools: toClaudeTools(params.tools),
      temperature: params.temperature,
      max_tokens: params.maxTokens ?? 1024,
      stream: true
    })
  });

  // 流式路径必须同时检查状态码和响应体是否可读。
  if (!response.ok || !response.body) {
    throw new Error(`Claude 流式请求失败: ${response.status}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let pending = "";
  let fullText = "";
  const toolCalls: LlmToolCall[] = [];

  // 统一流模型总是先发出 start 事件。
  yield { type: "start", provider: "claude", model };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    // Claude 也是 SSE，需要按空行切成一帧一帧解析。
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split("\n\n");
    pending = frames.pop() ?? "";

    for (const frame of frames) {
      const lines = frame.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));

      if (!eventLine || !dataLine) {
        continue;
      }

      const eventName = eventLine.slice(7);
      const payload = JSON.parse(dataLine.slice(6));

      // Claude 文本增量位于 delta.text 字段。
      if (eventName === "content_block_delta") {
        const delta = payload.delta?.text ?? "";

        if (!delta) {
          continue;
        }

        fullText += delta;
        yield { type: "text-delta", text: delta };
      }

      // Claude 工具块在完整出现时直接产出 tool-call。
      if (eventName === "content_block_start" && payload.content_block?.type === "tool_use") {
        const toolCall = {
          id: payload.content_block.id ?? "",
          name: (payload.content_block.name ?? "wait") as LlmToolCall["name"],
          arguments: payload.content_block.input ?? {}
        };

        toolCalls.push(toolCall);
        yield { type: "tool-call", toolCall };
      }
    }
  }

  // done 事件把整段文本和工具列表返回给统一门面，便于后续聚合复用。
  yield { type: "done", text: fullText, toolCalls, raw: undefined };
}
```

- [ ] **Step 4: 补充 Claude 流式 tool call 测试**

```ts
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
```

- [ ] **Step 5: 运行 Claude provider 全部测试**

Run: `bun test src/thinkable/llm/__tests__/claude.test.ts`
Expected: PASS，文本与 tool call 两组测试都通过

- [ ] **Step 6: 提交 Claude provider 改动**

```bash
git add src/thinkable/llm/providers/claude.ts src/thinkable/llm/__tests__/claude.test.ts
git commit -m "feat: add claude tool call support"
```

## Task 4: 收敛统一 client，并兼容现有测试与真实链路

**Files:**
- Modify: `src/thinkable/llm/client.ts`
- Modify: `src/thinkable/llm/index.ts`
- Modify: `src/thinkable/llm/__tests__/client.test.ts`
- Modify: `src/thinkable/llm/__tests__/real-openai.test.ts`

- [ ] **Step 1: 补充 client 层 stream done 事件的 toolCalls 测试**

```ts
it("stream 的 done 事件带回完整 toolCalls", async () => {
  process.env.OOC_PROVIDER = "claude";
  process.env.OOC_API_KEY = "test-key";
  process.env.OOC_BASE_URL = "https://example.com";
  process.env.OOC_MODEL = "claude-test";

  const body = [
    "event: content_block_start\n",
    'data: {"content_block":{"type":"tool_use","id":"toolu_1","name":"wait","input":{"reason":"hold"}}}\n\n'
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
    messages: [{ role: "user", content: "hi" }],
    tools: [
      {
        name: "wait",
        description: "等待外部信号",
        inputSchema: { type: "object" }
      }
    ]
  })) {
    events.push(event);
  }

  expect(events.at(-1)).toEqual({
    type: "done",
    text: "",
    toolCalls: [
      {
        id: "toolu_1",
        name: "wait",
        arguments: { reason: "hold" }
      }
    ],
    raw: undefined
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/thinkable/llm/__tests__/client.test.ts -t "stream 的 done 事件带回完整 toolCalls"`
Expected: FAIL，当前 `done` 事件没有 `toolCalls`

- [ ] **Step 3: 修改 client 与 index 导出，保持统一门面不新增第三入口**

```ts
import { readLlmEnv } from "./env";
import { generateWithClaude, streamWithClaude } from "./providers/claude";
import { generateWithOpenAi, streamWithOpenAi } from "./providers/openai";
import type { LlmClient, LlmGenerateParams } from "./types";

// 统一 client 负责解析默认配置，并把 provider 差异挡在内部。
export function createLlmClient(): LlmClient {
  return {
    // generate 先按 provider 分发，保持代码路径直接清晰。
    async generate(params) {
      const config = readLlmEnv();
      const provider = params.provider ?? config.provider;
      const merged = { ...params, provider } satisfies LlmGenerateParams;

      if (provider === "openai") {
        return generateWithOpenAi({ ...config, provider }, merged);
      }

      return generateWithClaude({ ...config, provider }, merged);
    },

    // stream 同样由统一门面分发到底层适配器。
    stream(params) {
      const config = readLlmEnv();
      const provider = params.provider ?? config.provider;
      const merged = { ...params, provider } satisfies LlmGenerateParams;

      if (provider === "openai") {
        return streamWithOpenAi({ ...config, provider }, merged);
      }

      return streamWithClaude({ ...config, provider }, merged);
    }
  };
}
```

- [ ] **Step 4: 调整真实 OpenAI 测试，只验证新结构仍可兼容**

```ts
import { describe, expect, it } from "bun:test";
import { createLlmClient } from "../client.ts";

// 真实链路测试默认不参与普通单测，只在显式设置开关时执行。
const shouldRunRealTest = process.env.RUN_REAL_OPENAI_TEST === "1";

describe.skipIf(!shouldRunRealTest)("real openai integration", () => {
  it("使用 .env 中的真实配置完成一次非流式请求", async () => {
    // 这条测试只验证真实链路能通，不追求复杂断言。
    process.env.OOC_PROVIDER = "openai";

    const client = createLlmClient();
    const result = await client.generate({
      messages: [
        {
          role: "system",
          content: "你是一个简洁的测试助手。"
        },
        {
          role: "user",
          content: "请只返回 OK 两个字母。"
        }
      ],
      temperature: 0
    });

    expect(result.provider).toBe("openai");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.toolCalls).toEqual([]);
  });
});
```

- [ ] **Step 5: 运行 client 与真实链路测试**

Run: `bun test src/thinkable/llm/__tests__/client.test.ts`
Expected: PASS，包含 toolCalls 的统一返回结构与 stream done 行为

Run: `RUN_REAL_OPENAI_TEST=1 bun test src/thinkable/llm/__tests__/real-openai.test.ts`
Expected: PASS，真实链路仍可返回文本且 `toolCalls` 为空数组

- [ ] **Step 6: 提交统一门面与测试兼容改动**

```bash
git add src/thinkable/llm/client.ts src/thinkable/llm/index.ts src/thinkable/llm/__tests__/client.test.ts src/thinkable/llm/__tests__/real-openai.test.ts
git commit -m "refactor: keep unified llm client for tool calls"
```

## Task 5: 新增 `context.ts`、`tools.ts`、`observable/index.ts` 占位模块

**Files:**
- Create: `src/thinkable/context.ts`
- Create: `src/executable/tools.ts`
- Create: `src/observable/index.ts`

- [ ] **Step 1: 先写占位模块的编译目标代码**

```ts
// src/thinkable/context.ts
import type { LlmMessage } from "./llm/types";

// ThreadContext 先只保留 think 单轮真正需要的字段。
export type ProcessEvent =
  | {
      category: "llm_interaction";
      kind: "text";
      text: string;
    }
  | {
      category: "llm_interaction";
      kind: "tool_use";
      toolName: "open" | "refine" | "submit" | "close" | "wait";
      arguments: Record<string, unknown>;
    }
  | {
      category: "llm_interaction";
      kind: "thinking";
      text: string;
    }
  | {
      category: "context_change";
      kind: "inject";
      text: string;
    };

// ThreadContext 当前不实现完整 thread runtime，只服务单轮执行。
export type ThreadContext = {
  id: string;
  status: "running" | "waiting" | "done" | "failed" | "paused";
  events: ProcessEvent[];
};

// buildContext 先给最小占位实现，后续由正式 context 系统替换。
export async function buildContext(thread: ThreadContext): Promise<LlmMessage[]> {
  void thread;
  return [];
}
```

```ts
// src/executable/tools.ts
import type { ThreadContext } from "../thinkable/context";
import type { LlmTool, LlmToolCall } from "../thinkable/llm/types";

// getAvailableTools 先返回空数组，占位表达“工具入口已建立”。
export function getAvailableTools(thread: ThreadContext): LlmTool[] {
  void thread;
  return [];
}

// dispatchToolCall 先提供空实现，后续接入真实 executable 能力。
export async function dispatchToolCall(
  thread: ThreadContext,
  toolCall: LlmToolCall
): Promise<void> {
  void thread;
  void toolCall;
}
```

```ts
// src/observable/index.ts
import type { ThreadContext } from "../thinkable/context";
import type { LlmGenerateResult, LlmMessage, LlmTool } from "../thinkable/llm/types";

// pause 能力先默认为 false，占位表达“暂停检查点存在”。
export function isPausing(thread: ThreadContext): boolean {
  void thread;
  return false;
}

// LLM 输入记录先保留空实现，后续接入真实 debug 文件输出。
export function writeLatestLlmInput(
  thread: ThreadContext,
  messages: LlmMessage[],
  tools: LlmTool[]
): void {
  void thread;
  void messages;
  void tools;
}

// LLM 输出记录同样先保留空实现，避免提前引入持久化细节。
export function writeLatestLlmOutput(
  thread: ThreadContext,
  result: LlmGenerateResult
): void {
  void thread;
  void result;
}
```

- [ ] **Step 2: 运行类型检查确认占位模块可编译**

Run: `bun test src/thinkable/llm/__tests__/client.test.ts`
Expected: PASS，占位模块加入后不影响现有 `llm` 测试

- [ ] **Step 3: 提交占位模块骨架**

```bash
git add src/thinkable/context.ts src/executable/tools.ts src/observable/index.ts
git commit -m "feat: add thinkloop placeholder modules"
```

## Task 6: 实现 `think(thread, llmClient)` 与单轮测试

**Files:**
- Create: `src/thinkable/thinkloop.ts`
- Create: `src/thinkable/__tests__/thinkloop.test.ts`

- [ ] **Step 1: 写出 `think` 的正常路径失败测试**

```ts
import { describe, expect, it, mock, spyOn } from "bun:test";
import * as contextModule from "../context.ts";
import * as toolsModule from "../../executable/tools.ts";
import * as observableModule from "../../observable/index.ts";
import { think } from "../thinkloop.ts";
import type { LlmClient } from "../llm/types";

describe("think", () => {
  it("执行单轮 think 并记录 text 与 tool_use 事件", async () => {
    const thread: contextModule.ThreadContext = {
      id: "thread-1",
      status: "running",
      events: []
    };

    spyOn(contextModule, "buildContext").mockResolvedValue([
      { role: "system", content: "context" }
    ]);
    spyOn(toolsModule, "getAvailableTools").mockReturnValue([
      {
        name: "wait",
        description: "等待",
        inputSchema: { type: "object" }
      }
    ]);
    const writeInput = spyOn(observableModule, "writeLatestLlmInput");
    const writeOutput = spyOn(observableModule, "writeLatestLlmOutput");
    const dispatch = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue();

    const llmClient: LlmClient = {
      async generate() {
        return {
          provider: "openai",
          model: "gpt-test",
          text: "需要等待",
          toolCalls: [
            {
              id: "call_1",
              name: "wait",
              arguments: { reason: "need input" }
            }
          ]
        };
      },
      async *stream() {
        yield { type: "start", provider: "openai", model: "gpt-test" };
        yield { type: "done", text: "", toolCalls: [] };
      }
    };

    await think(thread, llmClient);

    expect(writeInput).toHaveBeenCalledTimes(1);
    expect(writeOutput).toHaveBeenCalledTimes(1);
    expect(thread.events).toEqual([
      {
        category: "llm_interaction",
        kind: "text",
        text: "需要等待"
      },
      {
        category: "llm_interaction",
        kind: "tool_use",
        toolName: "wait",
        arguments: { reason: "need input" }
      }
    ]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/thinkable/__tests__/thinkloop.test.ts -t "执行单轮 think 并记录 text 与 tool_use 事件"`
Expected: FAIL，提示 `think` 文件尚不存在

- [ ] **Step 3: 实现 `thinkloop.ts` 最小主流程**

```ts
import { dispatchToolCall, getAvailableTools } from "../executable/tools";
import { isPausing, writeLatestLlmInput, writeLatestLlmOutput } from "../observable";
import { buildContext, type ThreadContext } from "./context";
import type { LlmClient } from "./llm/types";

// think 是单轮执行器，只负责编排本轮顺序，不承担 scheduler 和持久化。
export async function think(thread: ThreadContext, llmClient: LlmClient): Promise<void> {
  // 当前单轮执行只接受 running 状态，其他状态直接视为调用方错误。
  if (thread.status !== "running") {
    throw new Error(`think 只能处理 running 线程: ${thread.id}`);
  }

  try {
    // Context 模块先直接返回 LLM messages，避免中间层抽象。
    const messages = await buildContext(thread);
    const tools = getAvailableTools(thread);

    // 输入输出记录点先挂到 observable 占位模块上。
    await writeLatestLlmInput(thread, messages, tools);
    const result = await llmClient.generate({ messages, tools });

    // thinking 只记录，不负责回注到下一轮 context。
    if (result.thinking) {
      thread.events.push({
        category: "llm_interaction",
        kind: "thinking",
        text: result.thinking
      });
    }

    // 文本输出进入 process events，供后续 context-builder 消费。
    if (result.text) {
      thread.events.push({
        category: "llm_interaction",
        kind: "text",
        text: result.text
      });
    }

    // tool call 先记录，再由 executable 占位模块顺序执行。
    for (const toolCall of result.toolCalls) {
      thread.events.push({
        category: "llm_interaction",
        kind: "tool_use",
        toolName: toolCall.name,
        arguments: toolCall.arguments
      });
    }

    await writeLatestLlmOutput(thread, result);

    // pause 必须发生在输出记录之后、tool 执行之前。
    if (await isPausing(thread)) {
      thread.status = "paused";
      return;
    }

    for (const toolCall of result.toolCalls) {
      try {
        await dispatchToolCall(thread, toolCall);
      } catch (error) {
        thread.events.push({
          category: "context_change",
          kind: "inject",
          text: (error as Error).message
        });
        return;
      }
    }
  } catch (error) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: (error as Error).message
    });
    thread.status = "failed";
  }
}
```

- [ ] **Step 4: 补充 pause 与错误路径测试**

```ts
it("pause 时在 tool 执行前把线程改为 paused", async () => {
  const thread: contextModule.ThreadContext = {
    id: "thread-2",
    status: "running",
    events: []
  };

  spyOn(contextModule, "buildContext").mockResolvedValue([]);
  spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
  spyOn(observableModule, "isPausing").mockReturnValue(true);
  const dispatch = spyOn(toolsModule, "dispatchToolCall").mockResolvedValue();

  const llmClient: LlmClient = {
    async generate() {
      return {
        provider: "openai",
        model: "gpt-test",
        text: "暂停前输出",
        toolCalls: []
      };
    },
    async *stream() {
      yield { type: "start", provider: "openai", model: "gpt-test" };
      yield { type: "done", text: "", toolCalls: [] };
    }
  };

  await think(thread, llmClient);

  expect(thread.status).toBe("paused");
  expect(dispatch).not.toHaveBeenCalled();
});

it("llm 失败时写入 inject 并把线程改为 failed", async () => {
  const thread: contextModule.ThreadContext = {
    id: "thread-3",
    status: "running",
    events: []
  };

  spyOn(contextModule, "buildContext").mockResolvedValue([]);
  spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);

  const llmClient: LlmClient = {
    async generate() {
      throw new Error("llm exploded");
    },
    async *stream() {
      yield { type: "start", provider: "openai", model: "gpt-test" };
      yield { type: "done", text: "", toolCalls: [] };
    }
  };

  await think(thread, llmClient);

  expect(thread.status).toBe("failed");
  expect(thread.events.at(-1)).toEqual({
    category: "context_change",
    kind: "inject",
    text: "llm exploded"
  });
});

it("tool 失败时写入 inject 且停止后续 tool", async () => {
  const thread: contextModule.ThreadContext = {
    id: "thread-4",
    status: "running",
    events: []
  };

  spyOn(contextModule, "buildContext").mockResolvedValue([]);
  spyOn(toolsModule, "getAvailableTools").mockReturnValue([]);
  const dispatch = spyOn(toolsModule, "dispatchToolCall")
    .mockRejectedValueOnce(new Error("first tool failed"))
    .mockResolvedValueOnce();

  const llmClient: LlmClient = {
    async generate() {
      return {
        provider: "claude",
        model: "claude-test",
        text: "",
        toolCalls: [
          { id: "call_1", name: "open", arguments: {} },
          { id: "call_2", name: "close", arguments: {} }
        ]
      };
    },
    async *stream() {
      yield { type: "start", provider: "claude", model: "claude-test" };
      yield { type: "done", text: "", toolCalls: [] };
    }
  };

  await think(thread, llmClient);

  expect(thread.status).toBe("running");
  expect(thread.events.at(-1)).toEqual({
    category: "context_change",
    kind: "inject",
    text: "first tool failed"
  });
  expect(dispatch).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 5: 运行 `think` 测试**

Run: `bun test src/thinkable/__tests__/thinkloop.test.ts`
Expected: PASS，正常路径、pause、llm 失败、tool 失败都通过

- [ ] **Step 6: 提交 `think` 主流程**

```bash
git add src/thinkable/thinkloop.ts src/thinkable/__tests__/thinkloop.test.ts
git commit -m "feat: add think single-iteration loop"
```

## Task 7: 更新 `meta doc`，建立源码引用关系

**Files:**
- Modify: `meta/object/thinkable/llm/index.doc.js`
- Modify: `meta/object/thinkable/thinkloop/index.doc.js`

- [ ] **Step 1: 更新 `llm` 文档，补上 tool call 与源码引用**

```ts
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";

export const llm_v20260508_1 = {
  parent: thinkable_v20260504_1,
  index: `
llm 描述 Object 如何与大语言模型交互。

当前第一批实现覆盖：

- 统一 LLM client 门面
- OpenAI / Claude 两种协议适配
- 非流式文本输出
- 流式文本输出
- 原生 tool call
- 从 OOC_* 环境变量读取默认配置

对应源码位置：

- src/thinkable/llm/types.ts
- src/thinkable/llm/env.ts
- src/thinkable/llm/providers/openai.ts
- src/thinkable/llm/providers/claude.ts
- src/thinkable/llm/client.ts
- src/thinkable/llm/index.ts

当前不新增 chat()，统一通过 generate() / stream() 暴露文本与 tool call 能力。
`,
};
```

- [ ] **Step 2: 更新 `thinkloop` 文档，补上 `think` 与占位模块引用**

```ts
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";

export const thinkloop_v20260505_1 = {
  parent: thinkable_v20260504_1,
  index: `
ThinkLoop 是 Object 的思考引擎。
每一轮：context-build -> llm -> tool-use -> 循环。

当前第一批只实现单轮函数 think(thread, llmClient)。

本批次的外围能力先由占位函数承接：

- buildContext
- getAvailableTools
- dispatchToolCall
- isPausing
- writeLatestLlmInput
- writeLatestLlmOutput

对应源码位置：

- src/thinkable/context.ts
- src/thinkable/thinkloop.ts
- src/executable/tools.ts
- src/observable/index.ts
`,
};
```

- [ ] **Step 3: 运行相关测试确认文档更新不影响代码**

Run: `bun test src/thinkable/llm/__tests__ src/thinkable/__tests__/thinkloop.test.ts`
Expected: PASS，代码与测试保持通过

- [ ] **Step 4: 提交 meta doc 更新**

```bash
git add meta/object/thinkable/llm/index.doc.js meta/object/thinkable/thinkloop/index.doc.js
git commit -m "docs: link thinkloop sources in meta docs"
```

## Task 8: 运行完整验证

**Files:**
- Test only

- [ ] **Step 1: 运行全部 `llm` 与 `think` 测试**

Run: `bun test src/thinkable/llm/__tests__ src/thinkable/__tests__/thinkloop.test.ts`
Expected: PASS，所有单测通过

- [ ] **Step 2: 运行真实 OpenAI 测试**

Run: `RUN_REAL_OPENAI_TEST=1 bun test src/thinkable/llm/__tests__/real-openai.test.ts`
Expected: PASS，真实请求成功返回文本，`toolCalls` 为空数组

- [ ] **Step 3: 检查最近编辑文件诊断**

Run: 使用 `GetDiagnostics` 检查：
- `src/thinkable/llm/types.ts`
- `src/thinkable/llm/providers/openai.ts`
- `src/thinkable/llm/providers/claude.ts`
- `src/thinkable/thinkloop.ts`
- `src/thinkable/context.ts`
- `src/executable/tools.ts`
- `src/observable/index.ts`

Expected: 无新增诊断，或只有容易修复的轻微问题并当场修正

- [ ] **Step 4: 提交最终整体验证结果**

```bash
git add src/thinkable meta/object/thinkable src/executable/tools.ts src/observable/index.ts
git commit -m "feat: add think loop skeleton with llm tool calls"
```

## Self-Review

### Spec Coverage

- `llm` 的 `generate()` / `stream()` 支持原生 tool call：Task 1-4 覆盖
- `think(thread, llmClient)` 单轮执行：Task 5-6 覆盖
- `context.ts`、`tools.ts`、`observable/index.ts` 占位模块：Task 5 覆盖
- `meta doc` 同步更新与源码引用关系：Task 7 覆盖
- 保持真实 `.env` 文本链路测试：Task 4、Task 8 覆盖
- 中文注释密度与避免过早抽象：所有代码步骤均按小文件、直接逻辑设计

### Placeholder Scan

- 已检查无 `TODO`、`TBD`、`implement later` 之类占位符
- 每个代码步骤都包含明确代码块
- 每个验证步骤都包含准确命令和预期结果

### Type Consistency

- `LlmTool`、`LlmToolCall`、`LlmGenerateResult` 在所有任务中命名一致
- `ThreadContext` 统一定义在 `src/thinkable/context.ts`
- `think(thread, llmClient)` 在测试、实现、文档中命名一致
