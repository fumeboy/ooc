# Thread Tree Do Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the minimal thread-tree runtime fields and `do(fork|continue)` side effects needed to validate child-thread creation, inbox/outbox writes, waiting, and done-thread revival.

**Architecture:** Keep the first slice local to command execution. Extend `ThreadContext` with the smallest thread-tree fields, then make `executeDoCommand()` mutate those fields directly for fork and continue paths. Defer scheduler and cross-object collaboration to later tasks.

**Tech Stack:** TypeScript, Bun test, existing executable command layer

---

### Task 1: Lock Do Thread-Tree Behavior With Failing Tests

**Files:**
- Create: `src/executable/__tests__/do-thread-tree.test.ts`
- Modify: `src/thinkable/context.ts`
- Modify: `src/executable/commands/do.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { executeCommand } from "../commands";
import type { ThreadContext } from "../../thinkable/context";

describe("do thread tree core", () => {
  it("fork creates a running child thread, writes child inbox, updates parent outbox, and waits when requested", async () => {
    const parent: ThreadContext = { id: "t_parent", status: "running", events: [] };
    await executeCommand("do", {
      thread: parent,
      args: { context: "fork", msg: "处理日志", wait: true }
    });
    expect(parent.childThreadIds).toHaveLength(1);
    expect(parent.status).toBe("waiting");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/__tests__/do-thread-tree.test.ts`
Expected: FAIL because `ThreadContext` lacks thread-tree fields and `executeDoCommand()` is still a no-op.

- [ ] **Step 3: Write minimal implementation**

```ts
export type ThreadMessage = {
  id: string;
  fromThreadId: string;
  toThreadId: string;
  content: string;
  createdAt: number;
  source: "do" | "system";
};
```

```ts
export type ThreadContext = {
  ...
  parentThreadId?: string;
  creatorThreadId?: string;
  childThreadIds?: string[];
  childThreads?: Record<string, ThreadContext>;
  inbox?: ThreadMessage[];
  outbox?: ThreadMessage[];
  awaitingChildren?: string[];
};
```

```ts
if (ctxMode === "fork") {
  const childId = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const message = { ... };
  const child: ThreadContext = { id: childId, parentThreadId: ctx.thread.id, creatorThreadId: ctx.thread.id, status: "running", events: [], inbox: [message] };
  ctx.thread.childThreadIds = [...(ctx.thread.childThreadIds ?? []), childId];
  ctx.thread.childThreads = { ...(ctx.thread.childThreads ?? {}), [childId]: child };
  ctx.thread.outbox = [...(ctx.thread.outbox ?? []), message];
  if (args.wait === true) { ctx.thread.status = "waiting"; ctx.thread.waitingType = "await_children"; ctx.thread.awaitingChildren = [childId]; }
}
```

```ts
if (ctxMode === "continue") {
  const target = findThread(ctx.thread, targetThreadId);
  target.inbox = [...(target.inbox ?? []), message];
  ctx.thread.outbox = [...(ctx.thread.outbox ?? []), message];
  if (target.status === "done" || target.status === "failed") target.status = "running";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/executable/__tests__/do-thread-tree.test.ts`
Expected: PASS with fork/continue behavior covered.

- [ ] **Step 5: Commit**

```bash
git add src/executable/__tests__/do-thread-tree.test.ts src/thinkable/context.ts src/executable/commands/do.ts
git commit -m "feat: add do thread tree core side effects"
```
