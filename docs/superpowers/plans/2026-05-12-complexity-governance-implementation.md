# Complexity Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收敛 thread/job 状态语义，降低 `flows/context/program` 的偶然复杂度，同时保持对外 API、command 心智模型和关键行为契约不变。

**Architecture:** 先把状态迁移规则集中到 runtime policy 层，再把 `flows/service` 中的目录扫描和状态翻转下沉为 runtime/persistable 协作；随后将 `context` 升级为同名目录并抽离旁生投影逻辑，最后保留 `commands/program.ts` 作为入口，把具体执行逻辑迁入 `src/executable/program/` 并吸收现有 `sandbox/`。

**Tech Stack:** TypeScript, Bun, Elysia, 自研 thinkloop/runtime/persistable 模块

---

## 文件结构

### 计划新增/重组文件

- Create: `src/app/server/runtime/thread-transition.ts`
- Create: `src/app/server/runtime/thread-transition.test.ts`
- Create: `src/app/server/runtime/thread-query.ts`
- Create: `src/thinkable/context/index.ts`
- Create: `src/thinkable/context/render.ts`
- Create: `src/thinkable/context/knowledge.ts`
- Create: `src/thinkable/context/protocol.ts`
- Create: `src/executable/program/shell.ts`
- Create: `src/executable/program/function.ts`
- Create: `src/executable/program/format.ts`
- Create: `src/executable/program/types.ts`
- Create: `src/executable/program/self-env.ts`
- Create: `src/executable/program/sandbox/console.ts`
- Create: `src/executable/program/sandbox/executor.ts`
- Create: `src/executable/program/sandbox/wrap.ts`

### 计划修改文件

- Modify: `src/app/server/modules/flows/service.ts`
- Modify: `src/app/server/runtime/worker.ts`
- Modify: `src/thinkable/context.ts` 或迁移为 `src/thinkable/context/index.ts`
- Modify: `src/executable/commands/program.ts`
- Modify: `src/executable/__tests__/program.test.ts`
- Modify: `src/app/server/modules/flows/service.test.ts`
- Modify: `src/app/server/runtime/worker.test.ts`
- Modify: `src/executable/server/self.ts`（如 `program` 子目录迁移需要）
- Modify: `src/executable/server/loader.ts`（仅当 hot-reload 契约测试需要补缓存边界）
- Modify: import 引用 `../../thinkable/context` 与 `../sandbox/*` 的相关文件

### 主要验证命令

- `bun test src/app/server/runtime/thread-transition.test.ts`
- `bun test src/app/server/modules/flows/service.test.ts`
- `bun test src/app/server/runtime/worker.test.ts`
- `bun test src/executable/__tests__/program.test.ts`
- `bun test src/app/server src/executable src/thinkable`
- `bunx tsc --noEmit`

---

### Task 1: P0 收敛 thread 状态迁移规则

**Files:**
- Create: `src/app/server/runtime/thread-transition.ts`
- Test: `src/app/server/runtime/thread-transition.test.ts`
- Modify: `src/app/server/modules/flows/service.ts`
- Modify: `src/app/server/runtime/worker.ts`

- [ ] **Step 1: 写失败测试，固定 inject / resume 的状态转换契约**

```ts
import { describe, expect, test } from "bun:test";
import {
  canResumeThread,
  applyInjectTransition,
  applyResumeTransition,
} from "./thread-transition";

describe("thread transition", () => {
  test("inject resets failed thread to running and clears waiting metadata", () => {
    const next = applyInjectTransition({
      id: "root",
      status: "failed",
      events: [],
      waitingType: "await_children",
      awaitingChildren: ["child-1"],
    }, "继续");

    expect(next.status).toBe("running");
    expect(next.waitingType).toBeUndefined();
    expect(next.awaitingChildren).toBeUndefined();
    expect(next.events.at(-1)).toEqual({
      category: "context_change",
      kind: "inject",
      text: "继续",
    });
  });

  test("resume only accepts paused thread", () => {
    expect(canResumeThread({ status: "paused" } as never)).toBe(true);
    expect(canResumeThread({ status: "running" } as never)).toBe(false);
  });

  test("resume transition flips paused thread to running", () => {
    const next = applyResumeTransition({
      id: "root",
      status: "paused",
      events: [],
    });
    expect(next.status).toBe("running");
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `bun test src/app/server/runtime/thread-transition.test.ts`
Expected: FAIL，提示 `Cannot find module "./thread-transition"` 或导出不存在。

- [ ] **Step 3: 实现最小状态迁移规则文件**

```ts
import type { ThreadContext } from "@src/thinkable/context";

export function canResumeThread(thread: Pick<ThreadContext, "status">): boolean {
  return thread.status === "paused";
}

export function applyInjectTransition(thread: ThreadContext, text: string): ThreadContext {
  return {
    ...thread,
    status: "running",
    waitingType: undefined,
    awaitingChildren: undefined,
    events: [
      ...thread.events,
      { category: "context_change", kind: "inject", text },
    ],
  };
}

export function applyResumeTransition(thread: ThreadContext): ThreadContext {
  if (!canResumeThread(thread)) return thread;
  return {
    ...thread,
    status: "running",
    waitingType: undefined,
    awaitingChildren: undefined,
  };
}
```

- [ ] **Step 4: 在 `flows/service.ts` 中改用 transition policy**

```ts
const next = applyInjectTransition(thread, text);
await writeThread(next);
```

```ts
if (!canResumeThread(thread)) continue;
const next = applyResumeTransition(thread);
await writeThread(next);
```

- [ ] **Step 5: 在 `worker.ts` 中收敛 resume 前置判断**

```ts
if (job.kind === "resume-thread") {
  await resumePausedThread({ ... });
  return;
}
```

补充：若 `resumePausedThread` 当前内部仍有状态判断，应统一复用 `canResumeThread/applyResumeTransition`，避免重复语义。

- [ ] **Step 6: 运行测试确认通过**

Run: `bun test src/app/server/runtime/thread-transition.test.ts src/app/server/modules/flows/service.test.ts src/app/server/runtime/worker.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/server/runtime/thread-transition.ts \
  src/app/server/runtime/thread-transition.test.ts \
  src/app/server/modules/flows/service.ts \
  src/app/server/runtime/worker.ts \
  src/app/server/modules/flows/service.test.ts \
  src/app/server/runtime/worker.test.ts
git commit -m "refactor(runtime): centralize thread transitions"
```

---

### Task 2: P1 下沉 paused-thread 扫描与 flows service 旁生职责

**Files:**
- Create: `src/app/server/runtime/thread-query.ts`
- Modify: `src/app/server/modules/flows/service.ts`
- Test: `src/app/server/modules/flows/service.test.ts`

- [ ] **Step 1: 写失败测试，固定 `resumeSession` 通过 query helper 扫描 paused threads**

```ts
test("resumeSession only enqueues paused threads discovered by runtime query", async () => {
  const out = await service.resumeSession({ sessionId: "s-resume" });
  expect(out.resumedThreadIds).toEqual(["agent1/root"]);
  expect(out.jobIds.length).toBe(1);
});
```

补充断言：保留当前 `agent2.root` 不被入队。

- [ ] **Step 2: 运行目标测试并确认基线通过**

Run: `bun test src/app/server/modules/flows/service.test.ts`
Expected: PASS，作为重构保护网。

- [ ] **Step 3: 新增 runtime query helper**

```ts
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readThread } from "@src/persistable";

export async function scanPausedThreads(baseDir: string, sessionId: string) {
  // 迁移 service.ts 里的目录扫描逻辑到这里
}
```

- [ ] **Step 4: 精简 `flows/service.ts`，只保留 facade 行为**

```ts
const paused = await scanPausedThreads(deps.baseDir, sessionId);
for (const item of paused) {
  const job = deps.jobManager.createResumeThreadJob(item);
}
```

同时把以下逻辑从 service 层移出或压缩：

```ts
thread.events.push(...)
thread.status = "running"
thread.waitingType = undefined
thread.awaitingChildren = undefined
```

改为调用 Task 1 中的 transition helper。

- [ ] **Step 5: 运行测试确认 service 语义不变**

Run: `bun test src/app/server/modules/flows/service.test.ts src/app/server/runtime/thread-transition.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/server/runtime/thread-query.ts \
  src/app/server/modules/flows/service.ts \
  src/app/server/modules/flows/service.test.ts
git commit -m "refactor(flows): extract paused thread query"
```

---

### Task 3: P1 将 thinkable context 升级为同名目录，保留主干入口

**Files:**
- Create: `src/thinkable/context/index.ts`
- Create: `src/thinkable/context/render.ts`
- Create: `src/thinkable/context/knowledge.ts`
- Create: `src/thinkable/context/protocol.ts`
- Modify: `src/thinkable/context.ts`（迁移或删除）
- Modify: imports of `@src/thinkable/context`

- [ ] **Step 1: 写失败测试，锁定 `buildContext()` 现有行为**

如果当前没有专门测试，新增一个最小行为测试：

```ts
import { describe, expect, test } from "bun:test";
import { buildContext } from "./context";

test("buildContext keeps system xml and transcript projection stable", async () => {
  const messages = await buildContext({
    id: "root",
    status: "running",
    events: [
      { category: "context_change", kind: "inject", text: "继续" },
      { category: "llm_interaction", kind: "text", text: "收到" },
    ],
    activeForms: [],
  });

  expect(messages[0]?.role).toBe("system");
  expect(messages[0]?.content).toContain("<context>");
  expect(messages[1]?.content).toContain("[context_change:inject]");
  expect(messages[2]?.content).toContain("收到");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `bun test src/thinkable/context.test.ts`
Expected: FAIL，提示测试文件不存在或目标导出未覆盖。

- [ ] **Step 3: 创建 `context/` 目录并保留主干入口**

`src/thinkable/context/index.ts` 保留：

```ts
export type { ProcessEvent, ThreadMessage, ThreadContext } from "./types";
export { buildContext } from "./build-context";
```

如果不引入 `types.ts/build-context.ts`，也可采用更保守方案：

```ts
// index.ts 保留原主干，旁生逻辑迁到 render/knowledge/protocol
```

实现要求：
- `buildContext()` 主路径仍集中在一个文件
- `renderActiveForms` / `renderMessages` / `escapeXml` 可迁入 `render.ts`
- `computeKnowledgeXml` 迁入 `knowledge.ts`
- `inferNextAction` / `inferProtocolHint` 迁入 `protocol.ts`

- [ ] **Step 4: 调整引用并保持对外 import 路径不变**

```ts
import type { ThreadContext } from "../../thinkable/context";
```

这类引用应继续可用，不要求调用方感知目录升级。

- [ ] **Step 5: 运行 context 相关测试**

Run: `bun test src/thinkable/context.test.ts src/executable/__tests__/forms.test.ts src/app/server/runtime/worker.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/thinkable/context \
  src/thinkable/context.ts \
  src/thinkable/context.test.ts
git commit -m "refactor(thinkable): split context side concerns"
```

---

### Task 4: P2 重组 program 子系统并迁移 sandbox

**Files:**
- Modify: `src/executable/commands/program.ts`
- Create: `src/executable/program/shell.ts`
- Create: `src/executable/program/function.ts`
- Create: `src/executable/program/format.ts`
- Create: `src/executable/program/types.ts`
- Create: `src/executable/program/self-env.ts`
- Create: `src/executable/program/sandbox/console.ts`
- Create: `src/executable/program/sandbox/executor.ts`
- Create: `src/executable/program/sandbox/wrap.ts`
- Modify: `src/executable/__tests__/program.test.ts`
- Modify: imports pointing to `src/executable/sandbox/*`

- [ ] **Step 1: 写失败测试，固定 `program` 外部行为不变**

保留并扩充现有 `src/executable/__tests__/program.test.ts`，补一个 hot-reload 契约测试：

```ts
test("function path sees newly written server source immediately", async () => {
  const ref = await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
  const before = await executeProgramCommand(makeCtxWithPersistence({ function: "wordcount" }, "agent", tempRoot));
  expect(before).toContain("不存在");

  await writeServerSource(
    ref,
    `export const llm_methods = { wordcount: { fn: async (_c, { text }) => text.split(/\\s+/).length } };`
  );
  clearServerLoaderCache();

  const after = await executeProgramCommand(
    makeCtxWithPersistence({ function: "wordcount", args: { text: "a b c" } }, "agent", tempRoot)
  );
  expect(after).toContain("3");
});
```

- [ ] **Step 2: 运行 program 测试并确认基线**

Run: `bun test src/executable/__tests__/program.test.ts`
Expected: PASS 或仅新增 hot-reload 测试失败。

- [ ] **Step 3: 创建 `src/executable/program/` 并迁移执行细节**

核心要求：

```ts
// commands/program.ts
export async function executeProgramCommand(ctx: CommandExecutionContext) {
  // 保留 match/knowledge/path/入口分发
}
```

```ts
// program/shell.ts
export async function runShellProgram(code: string, env: Record<string, string>) {}
```

```ts
// program/function.ts
export async function runFunctionProgram(thread: ThreadContext, fn: string, args: Record<string, unknown>) {}
```

```ts
// program/format.ts
export function formatProgramResult(...) {}
export function formatShellResult(...) {}
```

- [ ] **Step 4: 迁移 sandbox 子目录**

把：

```text
src/executable/sandbox/
```

迁到：

```text
src/executable/program/sandbox/
```

并修正以下调用：

```ts
import { executeUserCode } from "../program/sandbox/executor";
```

- [ ] **Step 5: 让 `commands/program.ts` 只保留入口、knowledge、path**

目标形态：

```ts
export const KNOWLEDGE = `...`;
export enum ProgramCommandPath { ... }
export const programCommand = { ... };

export async function executeProgramCommand(ctx: CommandExecutionContext) {
  // 仅做模式分发和参数缺失兜底
}
```

- [ ] **Step 6: 运行 program 与 sandbox 相关测试**

Run: `bun test src/executable/__tests__/program.test.ts src/executable/__tests__/sandbox.test.ts src/executable/__tests__/server-self.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/executable/commands/program.ts \
  src/executable/program \
  src/executable/__tests__/program.test.ts \
  src/executable/__tests__/sandbox.test.ts \
  src/executable/__tests__/server-self.test.ts
git commit -m "refactor(program): extract program subsystem"
```

---

### Task 5: 全量回归与收尾

**Files:**
- Modify: docs if import paths or structure notes changed
- Verify: `src/app/server`, `src/executable`, `src/thinkable`

- [ ] **Step 1: 运行分模块回归**

Run: `bun test src/app/server src/executable src/thinkable`
Expected: PASS

- [ ] **Step 2: 运行类型检查**

Run: `bunx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 检查 diagnostics**

使用 IDE diagnostics 检查本轮修改文件，确认没有新增类型或导入错误。

- [ ] **Step 4: 更新文档（若目录结构变化需要同步）**

若 `context/` 或 `program/` 目录结构与 `meta`/spec 中的描述不一致，补最小必要文档更新。

- [ ] **Step 5: 最终提交**

```bash
git add docs/superpowers/specs/2026-05-12-complexity-governance-proposal.md \
  docs/superpowers/plans/2026-05-12-complexity-governance-implementation.md \
  src/app/server \
  src/thinkable \
  src/executable
git commit -m "refactor: execute complexity governance plan"
```

---

## 自查

- 覆盖 spec 的 P0/P1/P2 主线：已覆盖状态迁移、flows facade、context 目录升级、program 子系统重组。
- 占位词检查：无 `TBD`、`TODO`、`implement later`。
- 命名一致性：统一使用 `thread-transition`、`thread-query`、`program/*`、`context/*`。

---

Plan complete and saved to `docs/superpowers/plans/2026-05-12-complexity-governance-implementation.md`. 按你的要求，下一步我将直接采用 **Inline Execution** 继续执行，不再等待 plan 评审。
