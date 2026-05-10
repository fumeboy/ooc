# Build Context Inbox Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `buildContext()` so the LLM receives a system XML context containing thread status, forms, todos, inbox, and outbox.

**Architecture:** Keep this slice intentionally small. `buildContext()` returns a single `system` message rendered as XML; process events remain outside this task. Tests first lock the XML shape and the thinkloop integration point that passes the built messages into the LLM call path.

**Tech Stack:** TypeScript, Bun test, existing thinkloop/context modules

---

### Task 1: BuildContext XML Rendering

**Files:**
- Create: `src/thinkable/__tests__/context.test.ts`
- Modify: `src/thinkable/context.ts`
- Test: `src/thinkable/__tests__/thinkloop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("renders inbox and outbox into the system xml context", async () => {
  const thread: ThreadContext = {
    id: "t_parent",
    status: "running",
    events: [],
    creatorThreadId: "t_root",
    plan: "先处理 inbox",
    inbox: [{ ... }],
    outbox: [{ ... }],
    todos: [{ ... }],
    activeForms: [{ ... }]
  };
  const messages = await buildContext(thread);
  expect(messages[0]?.role).toBe("system");
  expect(messages[0]?.content).toContain("<context>");
  expect(messages[0]?.content).toContain("<inbox>");
  expect(messages[0]?.content).toContain("来自子线程的消息");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: FAIL because `buildContext()` currently returns `[]`.

- [ ] **Step 3: Write minimal implementation**

```ts
function escapeXml(text: string): string { ... }
function renderMessages(tag: "inbox" | "outbox", messages?: ThreadMessage[]): string { ... }
export async function buildContext(thread: ThreadContext): Promise<LlmMessage[]> {
  return [{ role: "system", content: `<context>...</context>` }];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/thinkable/__tests__/context.test.ts`
Expected: PASS with a single system XML message containing inbox/outbox.

- [ ] **Step 5: Extend thinkloop coverage**

Run: `bun test src/thinkable/__tests__/thinkloop.test.ts`
Expected: PASS after adding one assertion that `writeLatestLlmInput()` receives a system message containing the rendered XML.

- [ ] **Step 6: Commit**

```bash
git add src/thinkable/context.ts src/thinkable/__tests__/context.test.ts src/thinkable/__tests__/thinkloop.test.ts
git commit -m "feat: inject inbox outbox into build context"
```
