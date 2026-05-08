# Thinkable LLM Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 初始化最小 Bun + TypeScript 工程，并在 `src/thinkable/llm/` 下实现支持 OpenAI / Claude 协议、支持流式输出、支持从 `OOC_*` 环境变量读取配置的统一 LLM client。

**Architecture:** 采用“统一门面 + provider 适配器”的结构。`env.ts` 负责读取和校验 `OOC_*` 配置，`providers/openai.ts` 与 `providers/claude.ts` 分别处理协议差异，`client.ts` 负责选择 provider 并对外暴露统一的 `generate()` 和 `stream()` 接口。

**Tech Stack:** Bun、TypeScript、Bun test、原生 `fetch`、Markdown `doc.js` 元文档

---

## File Map

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/thinkable/llm/types.ts`
- Create: `src/thinkable/llm/env.ts`
- Create: `src/thinkable/llm/providers/openai.ts`
- Create: `src/thinkable/llm/providers/claude.ts`
- Create: `src/thinkable/llm/client.ts`
- Create: `src/thinkable/llm/index.ts`
- Create: `src/thinkable/llm/__tests__/env.test.ts`
- Create: `src/thinkable/llm/__tests__/openai.test.ts`
- Create: `src/thinkable/llm/__tests__/claude.test.ts`
- Create: `src/thinkable/llm/__tests__/client.test.ts`
- Create: `meta/object/thinkable/llm/index.doc.js`
- Modify: `meta/object/thinkable/index.doc.js`

### Task 1: 初始化 Bun 工程与测试骨架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/thinkable/llm/__tests__/env.test.ts`

- [ ] **Step 1: 初始化 Bun 项目**

Run: `bun init -y`
Expected: 生成 `package.json` 与 Bun 基础文件

- [ ] **Step 2: 收敛 `package.json`，只保留首批需要的最小内容**

```json
{
  "name": "ooc-2",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.9.0"
  }
}
```

- [ ] **Step 3: 写入最小 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "types": ["bun-types"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "meta/**/*.js"]
}
```

- [ ] **Step 4: 先写一个失败的测试，确认测试骨架可运行**

```ts
import { describe, expect, it } from "bun:test";

describe("bun test baseline", () => {
  it("可以运行测试文件", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: 运行测试，确认 Bun 工程已初始化成功**

Run: `bun test`
Expected: PASS，至少看到 `1 pass`

- [ ] **Step 6: 提交工程初始化**

```bash
git add package.json tsconfig.json src/thinkable/llm/__tests__/env.test.ts
git commit -m "chore: initialize bun typescript project"
```

### Task 2: 实现统一类型与环境变量配置

**Files:**
- Create: `src/thinkable/llm/types.ts`
- Create: `src/thinkable/llm/env.ts`
- Modify: `src/thinkable/llm/__tests__/env.test.ts`

- [ ] **Step 1: 先写失败测试，覆盖配置解析与基础类型依赖**

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { readLlmEnv } from "../env";

const KEYS = ["OOC_PROVIDER", "OOC_API_KEY", "OOC_BASE_URL", "OOC_MODEL"] as const;

afterEach(() => {
  for (const key of KEYS) {
    delete process.env[key];
  }
});

describe("readLlmEnv", () => {
  it("读取完整的 OOC 配置", () => {
    process.env.OOC_PROVIDER = "openai";
    process.env.OOC_API_KEY = "test-key";
    process.env.OOC_BASE_URL = "https://example.com/v1";
    process.env.OOC_MODEL = "gpt-test";

    expect(readLlmEnv()).toEqual({
      provider: "openai",
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "gpt-test"
    });
  });

  it("provider 非法时抛错", () => {
    process.env.OOC_PROVIDER = "glm";
    process.env.OOC_API_KEY = "test-key";
    process.env.OOC_BASE_URL = "https://example.com/v1";
    process.env.OOC_MODEL = "test-model";

    expect(() => readLlmEnv()).toThrow("OOC_PROVIDER");
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test src/thinkable/llm/__tests__/env.test.ts`
Expected: FAIL，报 `Cannot find module "../env"` 或 `readLlmEnv is not defined`

- [ ] **Step 3: 写入统一类型文件**

```ts
// LLM provider 只保留首批需要的两种协议，避免过早抽象。
export type LlmProvider = "openai" | "claude";

// 统一消息结构先只支持纯文本，后续再扩展多模态。
export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// 统一请求参数由上层传入，provider 与 model 允许按次覆盖默认值。
export type LlmGenerateParams = {
  provider?: LlmProvider;
  model?: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
};

// 非流式结果只保留首批需要的最终文本和调试字段。
export type LlmGenerateResult = {
  provider: LlmProvider;
  model: string;
  text: string;
  raw?: unknown;
};

// 流式事件统一成开始、文本增量、结束三种事件。
export type LlmStreamEvent =
  | { type: "start"; provider: LlmProvider; model: string }
  | { type: "text-delta"; text: string }
  | { type: "done"; text: string; raw?: unknown };

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

- [ ] **Step 4: 实现环境变量读取**

```ts
import type { LlmEnvConfig, LlmProvider } from "./types";

// 统一读取 OOC_* 配置，不支持 provider 专属覆盖层。
export function readLlmEnv(): LlmEnvConfig {
  const provider = (process.env.OOC_PROVIDER ?? "openai") as string;
  const apiKey = process.env.OOC_API_KEY;
  const baseUrl = process.env.OOC_BASE_URL;
  const model = process.env.OOC_MODEL;

  // 第一批只接受 openai / claude 两种协议，非法值直接抛错。
  if (provider !== "openai" && provider !== "claude") {
    throw new Error(`OOC_PROVIDER 无效: ${provider}`);
  }

  // 不做过度兜底，缺少关键字段时直接失败，保持逻辑直接。
  if (!apiKey) {
    throw new Error("缺少 OOC_API_KEY");
  }

  if (!baseUrl) {
    throw new Error("缺少 OOC_BASE_URL");
  }

  if (!model) {
    throw new Error("缺少 OOC_MODEL");
  }

  return {
    provider: provider as LlmProvider,
    apiKey,
    baseUrl,
    model
  };
}
```

- [ ] **Step 5: 补充缺失的失败路径测试**

```ts
it("缺少 OOC_API_KEY 时抛错", () => {
  process.env.OOC_PROVIDER = "openai";
  process.env.OOC_BASE_URL = "https://example.com/v1";
  process.env.OOC_MODEL = "gpt-test";

  expect(() => readLlmEnv()).toThrow("OOC_API_KEY");
});

it("缺少 OOC_MODEL 时抛错", () => {
  process.env.OOC_PROVIDER = "claude";
  process.env.OOC_API_KEY = "test-key";
  process.env.OOC_BASE_URL = "https://example.com/v1";

  expect(() => readLlmEnv()).toThrow("OOC_MODEL");
});
```

- [ ] **Step 6: 运行测试，确认类型与配置逻辑通过**

Run: `bun test src/thinkable/llm/__tests__/env.test.ts`
Expected: PASS，所有 `readLlmEnv` 相关用例通过

- [ ] **Step 7: 提交类型与配置**

```bash
git add src/thinkable/llm/types.ts src/thinkable/llm/env.ts src/thinkable/llm/__tests__/env.test.ts
git commit -m "feat: add llm env config and core types"
```

### Task 3: 实现 OpenAI 协议适配器

**Files:**
- Create: `src/thinkable/llm/providers/openai.ts`
- Create: `src/thinkable/llm/__tests__/openai.test.ts`

- [ ] **Step 1: 先写失败测试，覆盖非流式与流式两条路径**

```ts
import { describe, expect, it, mock } from "bun:test";
import { streamWithOpenAi, generateWithOpenAi } from "../providers/openai";

describe("openai provider", () => {
  it("解析非流式文本结果", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello from openai" } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as typeof fetch;

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
      'data: {"choices":[{"delta":{"content":"hel"}}]}\\n\\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\\n\\n',
      "data: [DONE]\\n\\n"
    ].join("");

    globalThis.fetch = mock(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    ) as typeof fetch;

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
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test src/thinkable/llm/__tests__/openai.test.ts`
Expected: FAIL，报 `Cannot find module "../providers/openai"`

- [ ] **Step 3: 实现 OpenAI 适配器**

```ts
import type { LlmEnvConfig, LlmGenerateParams, LlmGenerateResult, LlmStreamEvent } from "../types";

// OpenAI 非流式请求直接走 chat completions，返回统一结果。
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
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI 请求失败: ${response.status}`);
  }

  const raw = await response.json();
  const text = raw.choices?.[0]?.message?.content ?? "";

  return {
    provider: "openai",
    model: params.model ?? config.model,
    text,
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
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: true
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`OpenAI 流式请求失败: ${response.status}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let pending = "";
  let fullText = "";

  yield { type: "start", provider: "openai", model };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    pending += decoder.decode(value, { stream: true });
    const frames = pending.split("\\n\\n");
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
      const delta = json.choices?.[0]?.delta?.content ?? "";

      if (!delta) {
        continue;
      }

      fullText += delta;
      yield { type: "text-delta", text: delta };
    }
  }

  yield { type: "done", text: fullText, raw: undefined };
}
```

- [ ] **Step 4: 再补一个失败测试，覆盖 HTTP 错误**

```ts
it("非 2xx 状态码时抛错", async () => {
  globalThis.fetch = mock(async () => new Response("bad request", { status: 400 })) as typeof fetch;

  await expect(
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
```

- [ ] **Step 5: 运行测试，确认 OpenAI 适配器通过**

Run: `bun test src/thinkable/llm/__tests__/openai.test.ts`
Expected: PASS，非流式、流式、错误路径均通过

- [ ] **Step 6: 提交 OpenAI 适配器**

```bash
git add src/thinkable/llm/providers/openai.ts src/thinkable/llm/__tests__/openai.test.ts
git commit -m "feat: add openai llm provider adapter"
```

### Task 4: 实现 Claude 协议适配器

**Files:**
- Create: `src/thinkable/llm/providers/claude.ts`
- Create: `src/thinkable/llm/__tests__/claude.test.ts`

- [ ] **Step 1: 先写失败测试，覆盖 Claude 的非流式与流式路径**

```ts
import { describe, expect, it, mock } from "bun:test";
import { generateWithClaude, streamWithClaude } from "../providers/claude";

describe("claude provider", () => {
  it("解析非流式文本结果", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hello from claude" }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as typeof fetch;

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
      'event: content_block_delta\\n',
      'data: {"delta":{"type":"text_delta","text":"hel"}}\\n\\n',
      'event: content_block_delta\\n',
      'data: {"delta":{"type":"text_delta","text":"lo"}}\\n\\n'
    ].join("");

    globalThis.fetch = mock(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    ) as typeof fetch;

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
      { type: "done", text: "hello", raw: undefined }
    ]);
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test src/thinkable/llm/__tests__/claude.test.ts`
Expected: FAIL，报 `Cannot find module "../providers/claude"`

- [ ] **Step 3: 实现 Claude 适配器**

```ts
import type { LlmEnvConfig, LlmGenerateParams, LlmGenerateResult, LlmMessage, LlmStreamEvent } from "../types";

// Claude 只接受 user / assistant messages，system 单独提取成顶层字段。
function toClaudeMessages(messages: LlmMessage[]) {
  return messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role,
    content: message.content
  }));
}

// Claude 的 system 需要从统一 messages 中单独提取。
function toClaudeSystem(messages: LlmMessage[]) {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\\n\\n");
}

// Claude 非流式请求把 content 数组中的文本拼成最终结果。
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
      temperature: params.temperature,
      max_tokens: params.maxTokens ?? 1024,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Claude 请求失败: ${response.status}`);
  }

  const raw = await response.json();
  const text = (raw.content ?? [])
    .filter((item: { type?: string }) => item.type === "text")
    .map((item: { text?: string }) => item.text ?? "")
    .join("");

  return {
    provider: "claude",
    model: params.model ?? config.model,
    text,
    raw
  };
}

// Claude 流式事件以 SSE 形式返回，需要从 delta.text 中提取增量。
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
      temperature: params.temperature,
      max_tokens: params.maxTokens ?? 1024,
      stream: true
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`Claude 流式请求失败: ${response.status}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let pending = "";
  let fullText = "";

  yield { type: "start", provider: "claude", model };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    pending += decoder.decode(value, { stream: true });
    const frames = pending.split("\\n\\n");
    pending = frames.pop() ?? "";

    for (const frame of frames) {
      const lines = frame.split("\\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));

      if (!eventLine || !dataLine) {
        continue;
      }

      const eventName = eventLine.slice(7);
      if (eventName !== "content_block_delta") {
        continue;
      }

      const payload = JSON.parse(dataLine.slice(6));
      const delta = payload.delta?.text ?? "";

      if (!delta) {
        continue;
      }

      fullText += delta;
      yield { type: "text-delta", text: delta };
    }
  }

  yield { type: "done", text: fullText, raw: undefined };
}
```

- [ ] **Step 4: 再补一个失败测试，覆盖 HTTP 错误**

```ts
it("Claude 非 2xx 状态码时抛错", async () => {
  globalThis.fetch = mock(async () => new Response("bad request", { status: 401 })) as typeof fetch;

  await expect(
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
```

- [ ] **Step 5: 运行测试，确认 Claude 适配器通过**

Run: `bun test src/thinkable/llm/__tests__/claude.test.ts`
Expected: PASS，非流式、流式、错误路径均通过

- [ ] **Step 6: 提交 Claude 适配器**

```bash
git add src/thinkable/llm/providers/claude.ts src/thinkable/llm/__tests__/claude.test.ts
git commit -m "feat: add claude llm provider adapter"
```

### Task 5: 实现统一 client、导出入口与元文档引用

**Files:**
- Create: `src/thinkable/llm/client.ts`
- Create: `src/thinkable/llm/index.ts`
- Create: `src/thinkable/llm/__tests__/client.test.ts`
- Create: `meta/object/thinkable/llm/index.doc.js`
- Modify: `meta/object/thinkable/index.doc.js`

- [ ] **Step 1: 先写失败测试，覆盖 provider 选择、`generate()` 聚合和 `stream()` 输出**

```ts
import { describe, expect, it, mock } from "bun:test";
import { createLlmClient } from "../client";

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
    ) as typeof fetch;

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
    ) as typeof fetch;

    const client = createLlmClient();
    const result = await client.generate({
      provider: "claude",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(result.provider).toBe("claude");
    expect(result.text).toBe("hello from override");
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun test src/thinkable/llm/__tests__/client.test.ts`
Expected: FAIL，报 `Cannot find module "../client"`

- [ ] **Step 3: 实现统一 client**

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

- [ ] **Step 4: 增加统一导出入口**

```ts
export { createLlmClient } from "./client";
export { readLlmEnv } from "./env";
export type {
  LlmClient,
  LlmEnvConfig,
  LlmGenerateParams,
  LlmGenerateResult,
  LlmMessage,
  LlmProvider,
  LlmStreamEvent
} from "./types";
```

- [ ] **Step 5: 为源码补齐元文档节点**

```js
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";

export const llm_v20260508_1 = {
  parent: thinkable_v20260504_1,
  index: `
llm 描述 Object 如何与大语言模型交互。

当前第一批实现只覆盖最小核心闭环：

- 统一 LLM client 门面
- OpenAI / Claude 两种协议适配
- 非流式文本输出
- 流式文本输出
- 从 OOC_* 环境变量读取默认配置

对应源码位置：

- src/thinkable/llm/types.ts
- src/thinkable/llm/env.ts
- src/thinkable/llm/providers/openai.ts
- src/thinkable/llm/providers/claude.ts
- src/thinkable/llm/client.ts
- src/thinkable/llm/index.ts
`,
};
```

- [ ] **Step 6: 在 `thinkable` 总文档中暴露 `llm` 子节点**

```js
import { object_v20260504_1 } from "@meta";
import { executable_v20260504_1 } from "@meta/object/executable/index.doc";
import { identity_v20260505_1 } from "@meta/object/thinkable/identity.doc";
import { knowledge_v20260505_1 } from "@meta/object/thinkable/knowledge/index.doc";
import { thread_v20260505_1 } from "@meta/object/thinkable/thread/index.doc";
import { thinkloop_v20260505_1 } from "@meta/object/thinkable/thinkloop/index.doc";
import { context_v20260505_1 } from "@meta/object/thinkable/context/index.doc";
import { llm_v20260508_1 } from "@meta/object/thinkable/llm/index.doc";

export const thinkable_v20260504_1 = {
  parent: object_v20260504_1,
  index: `
Thinkable 描述 Object 的思考能力。

思考的核心是与 LLM 交互，关键是构造 LLM 输入（Context）。

子领域：

- identity
    - Object 对自己的双面认知 (自我 / 对我介绍)
- llm
    - Object 如何请求模型、处理 provider 协议差异与流式输出
- knowledge
    - Object 拥有什么知识，以及这些知识如何按 command 渐进式激活进入 Context
- context
    - 单轮 LLM 输入的组成与构建（Context Engineering）
- thread
    - 思考的运行时结构：线程树、节点状态、子线程、调度
- thinkloop
    - 单轮循环的引擎：context-build -> llm -> tool_use -> 循环
`,
  identity: identity_v20260505_1,
  llm: llm_v20260508_1,
  knowledge: knowledge_v20260505_1,
  context: context_v20260505_1,
  thread: thread_v20260505_1,
  thinkloop: thinkloop_v20260505_1,
  executable: executable_v20260504_1,
};
```

- [ ] **Step 7: 追加测试，覆盖 `stream()` 的最终结果**

```ts
it("stream 返回统一事件序列", async () => {
  process.env.OOC_PROVIDER = "openai";
  process.env.OOC_API_KEY = "test-key";
  process.env.OOC_BASE_URL = "https://example.com/v1";
  process.env.OOC_MODEL = "gpt-test";

  const body = [
    'data: {"choices":[{"delta":{"content":"hel"}}]}\\n\\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\\n\\n',
    "data: [DONE]\\n\\n"
  ].join("");

  globalThis.fetch = mock(async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    })
  ) as typeof fetch;

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
```

- [ ] **Step 8: 运行这一批全部测试**

Run: `bun test src/thinkable/llm/__tests__`
Expected: PASS，`env`、`openai`、`claude`、`client` 全部通过

- [ ] **Step 9: 提交统一 client 与文档引用**

```bash
git add src/thinkable/llm/client.ts src/thinkable/llm/index.ts src/thinkable/llm/__tests__/client.test.ts meta/object/thinkable/llm/index.doc.js meta/object/thinkable/index.doc.js
git commit -m "feat: add unified thinkable llm client"
```

## Self-Review

### Spec Coverage

- Bun 初始化：Task 1 覆盖
- 核心类型与 `OOC_*` 配置：Task 2 覆盖
- OpenAI 协议与流式：Task 3 覆盖
- Claude 协议与流式：Task 4 覆盖
- 统一 client：Task 5 覆盖
- 中文注释与避免过早抽象：所有代码步骤都按小文件、直接逻辑设计
- 源码与 `doc.js` 引用关系：Task 5 覆盖

### Placeholder Scan

- 已检查无 `TODO`、`TBD`、`implement later` 之类占位符
- 每个改代码的步骤都包含具体代码块
- 每个验证步骤都包含明确命令和预期

### Type Consistency

- 统一类型均以 `types.ts` 中的 `LlmProvider`、`LlmGenerateParams`、`LlmGenerateResult`、`LlmStreamEvent` 为准
- `readLlmEnv()`、`generateWithOpenAi()`、`generateWithClaude()`、`createLlmClient()` 的命名在各任务中保持一致
