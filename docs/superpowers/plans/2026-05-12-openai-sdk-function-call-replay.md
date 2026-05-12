# OpenAI SDK And Function Call Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OpenAI provider 切换到官方 `openai` SDK，并让 `buildInputItems()` 在下一轮请求中回放 `function_call` 与 `function_call_output`。

**Architecture:** 保持现有 `LlmGenerateParams/LlmGenerateResult` 契约不变，只替换 OpenAI provider 内部适配层。`context` 继续负责把线程事件投影为 Responses-first items，但不再过滤工具调用链，而是把 `function_call/function_call_output` 作为真实 transcript 的一部分回放。

**Tech Stack:** TypeScript, Bun, OpenAI SDK, OpenAI Responses API, 现有 thinkloop/context/debug 架构

---

## File Map

- Modify: `package.json`
- Modify: `src/thinkable/context/index.ts`
- Modify: `src/thinkable/llm/providers/openai.ts`
- Test: `src/thinkable/__tests__/context.test.ts`
- Test: `src/thinkable/llm/__tests__/openai.test.ts`

### Task 1: 回放 function call transcript

**Files:**
- Modify: `src/thinkable/context/index.ts`
- Test: `src/thinkable/__tests__/context.test.ts`

- [ ] **Step 1: 写失败测试，要求 buildInputItems 回放 function_call 与 function_call_output**
- [ ] **Step 2: 运行 context 测试，确认失败**
- [ ] **Step 3: 最小实现 processEventToItems 的 function_call/function_call_output 映射**
- [ ] **Step 4: 重新运行 context 测试，确认通过**

### Task 2: 切换 OpenAI 官方 SDK

**Files:**
- Modify: `package.json`
- Modify: `src/thinkable/llm/providers/openai.ts`
- Test: `src/thinkable/llm/__tests__/openai.test.ts`

- [ ] **Step 1: 写失败测试，要求 provider 通过官方 SDK 的 `responses.create()` 获取结果**
- [ ] **Step 2: 运行 openai 测试，确认失败**
- [ ] **Step 3: 安装 `openai` 依赖并以最小改动改写 provider**
- [ ] **Step 4: 重新运行 openai 测试，确认通过**

### Task 3: 完整验证

**Files:**
- Test: `src/thinkable/__tests__/context.test.ts`
- Test: `src/thinkable/llm/__tests__/openai.test.ts`

- [ ] **Step 1: 跑聚焦测试**
- [ ] **Step 2: 跑类型检查**
- [ ] **Step 3: 跑一次真实 server 链路，确认新生成的 llm.input.json 含 function_call/function_call_output 回放**
