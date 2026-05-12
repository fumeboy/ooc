# Responses-First Item Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OOC 的 LLM 输入输出主干从 message-only 重构为 Responses-first item model，并把 OpenAI provider 切到 `/v1/responses`。

**Architecture:** 内部以 `items` 作为唯一真相源，`buildContext()` 升级为 `buildInputItems()`，tool 调用与 tool 输出以 `function_call` / `function_call_output` 一等表达。OpenAI provider 直接对接 Responses API，Claude provider 负责把统一 items 映射到自身协议。

**Tech Stack:** TypeScript, Bun, OpenAI Responses API, Claude provider adapter, 当前 OOC thinkloop/executable/context 架构

---

## File Map

- Modify: `src/thinkable/llm/types.ts`
- Modify: `src/thinkable/context/index.ts`
- Modify: `src/thinkable/thinkloop.ts`
- Modify: `src/observable/index.ts`
- Modify: `src/persistable/debug-file.ts`
- Modify: `src/thinkable/llm/providers/openai.ts`
- Modify: `src/thinkable/llm/providers/claude-transport.ts`
- Modify: `src/thinkable/llm/providers/claude.ts`
- Modify: `src/executable/tools/open.ts`
- Modify: `src/executable/tools/submit.ts`
- Modify: `src/executable/tools/refine.ts`
- Modify: `src/executable/tools/close.ts`
- Test: `src/thinkable/__tests__/context.test.ts`
- Test: `src/thinkable/__tests__/thinkloop.test.ts`
- Test: `src/observable/__tests__/observable.test.ts`
- Test: `src/thinkable/llm/__tests__/openai.test.ts`
- Test: `src/thinkable/llm/__tests__/claude.test.ts`
- Test: `src/persistable/__tests__/persistable.test.ts`

### Task 1: 定义统一 Item 协议

**Files:**
- Modify: `src/thinkable/llm/types.ts`
- Test: `src/thinkable/__tests__/context.test.ts`

- [ ] **Step 1: 写失败测试，要求 context 构造输出 item 而不是纯 role/content messages**

```ts
it("buildInputItems returns system item plus inbox-linked user items", async () => {
  const out = await buildInputItems(thread);
  expect(out.input[0]).toEqual(
    expect.objectContaining({ type: "message", role: "system" })
  );
  expect(out.input.some((item) => item.type === "message" && item.role === "user")).toBe(true);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: FAIL，当前仍是 `buildContext(): LlmMessage[]`

- [ ] **Step 3: 最小实现 types**

```ts
export type LlmInputItem =
  | { type: "message"; role: "system" | "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: LlmToolName; arguments: Record<string, unknown> }
  | { type: "function_call_output"; call_id: string; name?: LlmToolName; output: string }
  | { type: "reasoning"; text: string };
```

- [ ] **Step 4: 重新运行测试，确认类型入口通过**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: 进入下一层红灯，但类型名已生效

### Task 2: 重写 context 构造为 buildInputItems

**Files:**
- Modify: `src/thinkable/context/index.ts`
- Test: `src/thinkable/__tests__/context.test.ts`

- [ ] **Step 1: 写失败测试，锁定 user_input 表达为 inbox + context_change(msg_id)**

```ts
it("maps inbox message arrival into user item plus msg_id notice item", async () => {
  const out = await buildInputItems(threadWithInboxArrival());
  expect(out.input).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "message", role: "user" }),
      expect.objectContaining({ type: "message", role: "system", content: expect.stringContaining("msg_id=") })
    ])
  );
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: FAIL，当前 `context_change/inject` 仍混成 `user`

- [ ] **Step 3: 最小实现 buildInputItems**

```ts
export async function buildInputItems(thread: ThreadContext): Promise<{ instructions?: string; input: LlmInputItem[] }> {
  const systemXml = await renderContextXml(...);
  return {
    input: [
      { type: "message", role: "system", content: systemXml },
      ...mappedItems
    ]
  };
}
```

- [ ] **Step 4: 运行 context 测试，确认通过**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: PASS

### Task 3: 把 tool 调用链提升为一等 items

**Files:**
- Modify: `src/thinkable/thinkloop.ts`
- Modify: `src/executable/tools/open.ts`
- Modify: `src/executable/tools/submit.ts`
- Modify: `src/executable/tools/refine.ts`
- Modify: `src/executable/tools/close.ts`
- Test: `src/thinkable/__tests__/thinkloop.test.ts`

- [ ] **Step 1: 写失败测试，要求 thinkloop 记录 function_call 与 function_call_output**

```ts
it("records function_call and function_call_output items for tool execution", async () => {
  await think(thread, llmClientReturningToolCall());
  expect(thread.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "function_call", callId: expect.any(String) }),
      expect.objectContaining({ kind: "function_call_output", callId: expect.any(String) })
    ])
  );
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/thinkable/__tests__/thinkloop.test.ts`
Expected: FAIL，当前只有 `tool_use` + inject

- [ ] **Step 3: 最小实现 thinkloop + tool output helper**

```ts
for (const toolCall of result.outputItems.filter(isFunctionCall)) {
  thread.events.push({ category: "llm_interaction", kind: "function_call", ... });
  const output = await dispatchToolCall(...);
  thread.events.push({ category: "tool_runtime", kind: "function_call_output", ... });
}
```

- [ ] **Step 4: 运行 thinkloop 测试，确认通过**

Run: `bun test src/thinkable/__tests__/thinkloop.test.ts`
Expected: PASS

### Task 4: 升级 debug 落盘 schema

**Files:**
- Modify: `src/observable/index.ts`
- Modify: `src/persistable/debug-file.ts`
- Test: `src/observable/__tests__/observable.test.ts`
- Test: `src/persistable/__tests__/persistable.test.ts`

- [ ] **Step 1: 写失败测试，要求 debug 文件落 `input_items` / `output_items`**

```ts
expect(debug.input).toEqual(
  expect.objectContaining({
    threadId: "t1",
    inputItems: expect.any(Array)
  })
);
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/observable/__tests__/observable.test.ts src/persistable/__tests__/persistable.test.ts`
Expected: FAIL，当前还是 `messages`

- [ ] **Step 3: 最小实现 debug schema**

```ts
input: {
  threadId: thread.id,
  inputItems,
  tools
}
```

```ts
output: {
  threadId: thread.id,
  outputItems,
  provider: result.provider,
  model: result.model
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `bun test src/observable/__tests__/observable.test.ts src/persistable/__tests__/persistable.test.ts`
Expected: PASS

### Task 5: OpenAI provider 切到 Responses API

**Files:**
- Modify: `src/thinkable/llm/providers/openai.ts`
- Test: `src/thinkable/llm/__tests__/openai.test.ts`

- [ ] **Step 1: 写失败测试，要求请求命中 `/v1/responses` 且返回 output items**

```ts
expect(fetch).toHaveBeenCalledWith(
  expect.stringContaining("/v1/responses"),
  expect.any(Object)
);
```

```ts
expect(result.outputItems).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ type: "message" })
  ])
);
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/thinkable/llm/__tests__/openai.test.ts`
Expected: FAIL，当前请求仍是 `/chat/completions`

- [ ] **Step 3: 最小实现 Responses API 请求与解析**

```ts
const response = await fetch(`${config.baseUrl}/responses`, {
  method: "POST",
  body: JSON.stringify({
    model,
    input: params.input,
    instructions: params.instructions,
    tools: toOpenAiResponsesTools(params.tools),
    store: false
  })
});
```

- [ ] **Step 4: 运行 openai 测试，确认通过**

Run: `bun test src/thinkable/llm/__tests__/openai.test.ts`
Expected: PASS

### Task 6: Claude provider 适配统一 item 协议

**Files:**
- Modify: `src/thinkable/llm/providers/claude-transport.ts`
- Modify: `src/thinkable/llm/providers/claude.ts`
- Test: `src/thinkable/llm/__tests__/claude.test.ts`

- [ ] **Step 1: 写失败测试，要求 Claude 输入来自 items，输出归一化为 items**

```ts
expect(result.outputItems).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ type: "message" })
  ])
);
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `bun test src/thinkable/llm/__tests__/claude.test.ts`
Expected: FAIL，当前仍是 `text + toolCalls`

- [ ] **Step 3: 最小实现 item adapter**

```ts
system: toClaudeSystemFromItems(params.input),
messages: toClaudeMessagesFromItems(params.input),
```

```ts
return {
  provider: "claude",
  model,
  outputItems
};
```

- [ ] **Step 4: 运行 claude 测试，确认通过**

Run: `bun test src/thinkable/llm/__tests__/claude.test.ts`
Expected: PASS

### Task 7: 完整回归验证

**Files:**
- Test: `src/thinkable/__tests__/context.test.ts`
- Test: `src/thinkable/__tests__/thinkloop.test.ts`
- Test: `src/observable/__tests__/observable.test.ts`
- Test: `src/thinkable/llm/__tests__/openai.test.ts`
- Test: `src/thinkable/llm/__tests__/claude.test.ts`
- Test: `src/persistable/__tests__/persistable.test.ts`

- [ ] **Step 1: 跑聚焦测试集**

Run: `bun test src/thinkable/__tests__/context.test.ts src/thinkable/__tests__/thinkloop.test.ts src/observable/__tests__/observable.test.ts src/thinkable/llm/__tests__/openai.test.ts src/thinkable/llm/__tests__/claude.test.ts src/persistable/__tests__/persistable.test.ts`
Expected: PASS

- [ ] **Step 2: 跑类型检查**

Run: `bunx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: 检查最近编辑文件 diagnostics**

Run: IDE diagnostics on touched files
Expected: no new errors
