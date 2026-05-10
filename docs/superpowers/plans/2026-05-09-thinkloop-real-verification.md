# Thinkloop Real Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic command side effects plus layered tests so `think -> tool call -> command execute` can be verified locally and with a gated real API smoke test.

**Architecture:** Extend `ThreadContext` with the smallest observable state needed for `plan`, `todo`, and `end` to mutate thread state. First lock those side effects with focused tests, then add an integration test that drives real `think()` orchestration through `open/refine/submit`, and finally add a real API smoke test behind an environment flag.

**Tech Stack:** TypeScript, Bun test, Bun runtime, existing LLM client and thinkloop modules

---

### Task 1: Thread State And Core Command Side Effects

**Files:**
- Modify: `src/thinkable/context.ts`
- Modify: `src/executable/commands/plan.ts`
- Modify: `src/executable/commands/todo.ts`
- Modify: `src/executable/commands/end.ts`
- Test: `src/executable/__tests__/commands-execution.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { executeCommand } from "../commands";
import type { ThreadContext } from "../../thinkable/context";

describe("command execution side effects", () => {
  it("plan should write thread.plan", async () => {
    const thread: ThreadContext = { id: "t_plan", status: "running", events: [] };
    await executeCommand("plan", {
      thread,
      args: { goal: "完成迁移", context: "先补测试" }
    });
    expect(thread.plan).toContain("完成迁移");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/__tests__/commands-execution.test.ts`
Expected: FAIL because `ThreadContext` lacks the observable fields and `executePlanCommand()` is still a no-op.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/thinkable/context.ts
export type ThreadTodo = {
  content: string;
  onCommandPath?: string[];
  createdAt: number;
  completedAt?: number;
};

export type ThreadContext = {
  ...
  plan?: string;
  todos?: ThreadTodo[];
  endReason?: string;
  endResult?: string;
};
```

```ts
// src/executable/commands/plan.ts
export async function executePlanCommand(ctx: CommandExecutionContext): Promise<void> {
  if (!ctx.thread) return;
  const goal = typeof ctx.args.goal === "string" ? ctx.args.goal : "";
  const context = typeof ctx.args.context === "string" ? ctx.args.context : "";
  ctx.thread.plan = [goal, context].filter(Boolean).join("\n\n");
}
```

```ts
// src/executable/commands/todo.ts
export async function executeTodoCommand(ctx: CommandExecutionContext): Promise<void> {
  if (!ctx.thread) return;
  const content = typeof ctx.args.content === "string" ? ctx.args.content : "";
  const onCommandPath = Array.isArray(ctx.args.on_command_path)
    ? ctx.args.on_command_path.filter((item): item is string => typeof item === "string")
    : undefined;
  ctx.thread.todos = [...(ctx.thread.todos ?? []), { content, onCommandPath, createdAt: Date.now() }];
}
```

```ts
// src/executable/commands/end.ts
export async function executeEndCommand(ctx: CommandExecutionContext): Promise<void> {
  if (!ctx.thread) return;
  ctx.thread.endReason = typeof ctx.args.reason === "string" ? ctx.args.reason : undefined;
  ctx.thread.endResult = typeof ctx.args.result === "string" ? ctx.args.result : undefined;
  ctx.thread.status = "done";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/executable/__tests__/commands-execution.test.ts`
Expected: PASS with `plan`, `todo`, and `end` visibly mutating thread state.

- [ ] **Step 5: Commit**

```bash
git add src/thinkable/context.ts src/executable/commands/plan.ts src/executable/commands/todo.ts src/executable/commands/end.ts src/executable/__tests__/commands-execution.test.ts
git commit -m "feat: add core command execution side effects"
```

### Task 2: Thinkloop Integration Test

**Files:**
- Modify: `src/thinkable/__tests__/thinkloop.test.ts`
- Reuse: `src/thinkable/thinkloop.ts`
- Reuse: `src/executable/tools/submit.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it("runs think through open refine submit and executes todo command", async () => {
  const thread: ThreadContext = { id: "thread-int", status: "running", events: [] };
  const llmClient: LlmClient = {
    async generate() {
      return {
        provider: "openai",
        model: "gpt-test",
        text: "登记待办",
        toolCalls: [
          { id: "1", name: "open", arguments: { type: "command", command: "todo", description: "登记待办" } },
          { id: "2", name: "refine", arguments: { form_id: expect.any(String), args: { content: "补测试" } } },
          { id: "3", name: "submit", arguments: { form_id: expect.any(String) } }
        ]
      };
    },
    async *stream() { yield { type: "done", text: "", toolCalls: [] }; }
  };
  await think(thread, llmClient);
  expect(thread.todos?.map((item) => item.content)).toContain("补测试");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/thinkable/__tests__/thinkloop.test.ts`
Expected: FAIL because command execution currently does not persist an observable todo result through the submit flow.

- [ ] **Step 3: Write minimal implementation adjustments**

```ts
// Keep tool/thinkloop orchestration intact; only adjust test harness
// to capture the generated form_id dynamically via a fake client closure.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/thinkable/__tests__/thinkloop.test.ts`
Expected: PASS with a real `think()` call executing `open -> refine -> submit -> executeCommand`.

- [ ] **Step 5: Commit**

```bash
git add src/thinkable/__tests__/thinkloop.test.ts
git commit -m "test: cover thinkloop command execution integration"
```

### Task 3: Real API Thinkloop Smoke Test

**Files:**
- Create: `src/thinkable/__tests__/real-thinkloop.test.ts`
- Reuse: `src/thinkable/llm/__tests__/real-openai.test.ts`

- [ ] **Step 1: Write the gated real API test**

```ts
const shouldRunRealTest = process.env.RUN_REAL_THINKLOOP_TEST === "1";

describe.skipIf(!shouldRunRealTest)("real thinkloop integration", () => {
  it("drives a real model through end command flow", async () => {
    loadRealEnv();
    const client = createLlmClient();
    const thread: ThreadContext = { id: "real-think", status: "running", events: [] };
    await think(thread, client);
    expect(["running", "done", "waiting", "paused"]).toContain(thread.status);
  }, 90000);
});
```

- [ ] **Step 2: Run test in skipped mode to verify local safety**

Run: `bun test src/thinkable/__tests__/real-thinkloop.test.ts`
Expected: PASS with test skipped unless `RUN_REAL_THINKLOOP_TEST=1`.

- [ ] **Step 3: Run real smoke test with env flag**

Run: `RUN_REAL_THINKLOOP_TEST=1 bun test src/thinkable/__tests__/real-thinkloop.test.ts`
Expected: PASS if the configured model follows the instructed tool call path; otherwise inspect the output and tighten the prompt/test scenario.

- [ ] **Step 4: Commit**

```bash
git add src/thinkable/__tests__/real-thinkloop.test.ts
git commit -m "test: add real thinkloop smoke coverage"
```
