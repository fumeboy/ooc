# Inbox Event And Close Form Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户输入统一表达为 `thread.inbox + inbox_message_arrived(msgId)`，并把 `close` 工具收敛为仅按 `form_id` 关闭 form。

**Architecture:** `flows/service` 负责把初始消息和 continue 消息写入 `thread.inbox`，同时追加 `inbox_message_arrived` 事件。`buildInputItems()` 仅把该事件投影成 msg_id 通知，不再把用户正文复制成 inject user message；用户正文只留在 XML 的 `<inbox>` 中。`close` 工具删除 knowledge 分支，只保留 form close 语义。

**Tech Stack:** TypeScript, Bun, Elysia, OOC thinkloop/context/executable

---

## File Map

- Modify: `src/app/server/modules/flows/service.ts`
- Modify: `src/app/server/modules/flows/service.test.ts`
- Modify: `src/thinkable/context/index.ts`
- Modify: `src/thinkable/__tests__/context.test.ts`
- Modify: `src/executable/tools/close.ts`
- Modify: `src/executable/__tests__/tools.test.ts`
- Modify: `src/app/server/__tests__/server.e2e.test.ts`
- Modify: `src/app/server/__tests__/real-app-server.test.ts`

### Task 1: 收敛用户输入协议

**Files:**
- Modify: `src/app/server/modules/flows/service.ts`
- Test: `src/app/server/modules/flows/service.test.ts`
- Modify: `src/thinkable/context/index.ts`
- Test: `src/thinkable/__tests__/context.test.ts`

- [ ] **Step 1: 写失败测试，要求 initialMessage/continueThread 写入 inbox 并产生 inbox_message_arrived**
- [ ] **Step 2: 跑 flows/context 测试确认失败**
- [ ] **Step 3: 最小实现 service 与 context 投影**
- [ ] **Step 4: 重跑 flows/context 测试确认通过**

### Task 2: 收窄 close 协议

**Files:**
- Modify: `src/executable/tools/close.ts`
- Test: `src/executable/__tests__/tools.test.ts`

- [ ] **Step 1: 写失败测试，要求 close 不再接受 type/path，且仅支持 form_id + reason**
- [ ] **Step 2: 跑 tools 测试确认失败**
- [ ] **Step 3: 最小实现 close tool schema 与 handler**
- [ ] **Step 4: 重跑 tools 测试确认通过**

### Task 3: 回归验证

**Files:**
- Test: `src/app/server/modules/flows/service.test.ts`
- Test: `src/thinkable/__tests__/context.test.ts`
- Test: `src/executable/__tests__/tools.test.ts`
- Test: `src/app/server/__tests__/server.e2e.test.ts`
- Test: `src/app/server/__tests__/real-app-server.test.ts`

- [ ] **Step 1: 跑相关测试集**
- [ ] **Step 2: 跑类型检查**
- [ ] **Step 3: 再做一次本地真实链路验证，确认 llm.input.json 中 system XML 含 inbox，且 transcript 只有 msg_id event 不再重复用户正文**
