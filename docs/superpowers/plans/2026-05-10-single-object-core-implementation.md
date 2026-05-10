# Single Object Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不实现多 object `talk` 交互的前提下，完成单 object 的 thinkable、executable、observable、persistable 最小闭环。

**Architecture:** 以 `ThreadContext` 作为运行时核心模型，`persistable` 负责把单个 flow object 的线程与 debug 快照写入文件系统，`observable` 负责在 thinkloop 前后记录 LLM 输入输出，`scheduler` 负责驱动单 object 内的线程树。`talk` 仅保留 command/path/doc 位置，本阶段不跨 object 投递消息。

**Tech Stack:** TypeScript, Bun test, Node `fs/promises`, 现有 `src/thinkable`、`src/executable`、`src/observable` 模块。

---

## Scope

本阶段实现：
- 单 flow object 目录初始化：`flows/{sessionId}/objects/{objectId}/`
- 单 object 线程持久化：`threads/{threadId}/thread.json`
- 单 object debug 文件：`threads/{threadId}/debug/llm.input.json`、`llm.output.json`
- ThinkLoop 与 Scheduler 的单 object 执行闭环
- 已有 tools/commands 的本对象内行为：`open/refine/submit/close/wait`，`plan/todo/do/end`
- `program` 与 `talk` 保持明确占位：可被 open/refine/submit，但不会执行未定义副作用

本阶段不实现：
- 多 object `talk` 投递、远端 object 查找、跨 flow 消息同步
- `compress` tool 的执行逻辑
- server/client 的真实方法调用与 UI 渲染
- stone 与 flow 的双层数据合并

## File Structure

- Modify: `meta/object/persistable/index.doc.js`
  - 增加单 object 阶段边界与 `sources` 绑定。
- Modify: `meta/object/observable/index.doc.js`
  - 增加 observable 与 debug 文件实现的 `sources` 绑定。
- Modify: `meta/object/thinkable/thread/scheduler.doc.js`
  - 明确 scheduler 会在单 object flow 中持久化线程。
- Create: `src/persistable/types.ts`
  - 定义 flow object、thread record、debug record 的持久化类型。
- Create: `src/persistable/paths.ts`
  - 只负责从 `baseDir/sessionId/objectId/threadId` 计算文件路径。
- Create: `src/persistable/flow-object.ts`
  - 负责初始化 flow object 目录与 `.flow.json`。
- Create: `src/persistable/thread-store.ts`
  - 负责读写 `ThreadContext` 到 `thread.json`。
- Create: `src/persistable/debug-store.ts`
  - 负责写入 `llm.input.json`、`llm.output.json`。
- Create: `src/persistable/index.ts`
  - 统一导出 persistable API。
- Modify: `src/thinkable/context.ts`
  - 给 `ThreadContext` 增加可选 `persistence` 引用，运行时知道当前线程的存储位置。
- Modify: `src/observable/index.ts`
  - 在现有内存快照基础上，若线程带有 `persistence`，同步写 debug 文件。
- Modify: `src/thinkable/scheduler.ts`
  - 每轮 think 后保存被执行线程与根线程树。
- Create: `src/persistable/__tests__/persistable.test.ts`
  - 覆盖目录初始化、线程读写、debug 写入。
- Create: `src/thinkable/__tests__/single-object-runtime.test.ts`
  - 覆盖 scheduler + persistable + observable 的单 object 闭环。

---

### Task 1: Document Single Object Boundaries

**Files:**
- Modify: `meta/object/persistable/index.doc.js`
- Modify: `meta/object/observable/index.doc.js`
- Modify: `meta/object/thinkable/thread/scheduler.doc.js`

- [ ] **Step 1: Add persistable sources and phase boundary**

Add source imports near the top of `meta/object/persistable/index.doc.js`:

```js
import * as persistable from "@src/persistable/index";
```

Add this paragraph to the `index` template after the flow file list:

```md
## 当前实现阶段

当前实现只覆盖单 object flow：
- 初始化 `flows/{sessionId}/objects/{objectId}/`
- 读写 `threads/{threadId}/thread.json`
- 写入 `threads/{threadId}/debug/llm.input.json`
- 写入 `threads/{threadId}/debug/llm.output.json`

本阶段不实现 stone/flow 合并、多 object session 协作、跨 object talk 投递。
```

Add sources to the exported object:

```js
  sources: {
    persistable
  }
```

- [ ] **Step 2: Add observable sources**

Add source imports near the top of `meta/object/observable/index.doc.js`:

```js
import * as observable from "@src/observable/index";
```

Add sources to the exported object:

```js
  sources: {
    observable
  }
```

- [ ] **Step 3: Clarify scheduler persistence responsibility**

Add this paragraph to `meta/object/thinkable/thread/scheduler.doc.js`:

```md
当前实现中，scheduler 仍只负责单 object 内的线程树调度。若线程携带 persistable 引用，scheduler 在每轮 think 后保存线程状态；跨 object 调度与 talk 同步不属于本阶段。
```

- [ ] **Step 4: Run documentation syntax check**

Run:

```bash
bunx tsc --noEmit
```

Expected: exit code `0`.

- [ ] **Step 5: Commit**

```bash
git add meta/object/persistable/index.doc.js meta/object/observable/index.doc.js meta/object/thinkable/thread/scheduler.doc.js
git commit -m "docs: define single object persistence scope"
```

---

### Task 2: Persistable Foundation

**Files:**
- Create: `src/persistable/types.ts`
- Create: `src/persistable/paths.ts`
- Create: `src/persistable/flow-object.ts`
- Create: `src/persistable/thread-store.ts`
- Create: `src/persistable/debug-store.ts`
- Create: `src/persistable/index.ts`
- Test: `src/persistable/__tests__/persistable.test.ts`

- [ ] **Step 1: Write failing persistable tests**

Create `src/persistable/__tests__/persistable.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createFlowObject,
  readThread,
  resolvePersistablePaths,
  writeDebugInput,
  writeDebugOutput,
  writeThread
} from "../index";
import type { ThreadContext } from "../../thinkable/context";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("persistable single object flow", () => {
  test("creates a flow object directory with metadata", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-persistable-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj"
    });

    const paths = resolvePersistablePaths(ref);
    const metadata = JSON.parse(await readFile(paths.flowMetadataFile, "utf8"));

    expect(metadata).toEqual({
      type: "flow-object",
      sessionId: "s1",
      objectId: "obj"
    });
  });

  test("writes and reads a thread json file", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-persistable-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj"
    });
    const thread: ThreadContext = {
      id: "root",
      status: "running",
      events: [],
      persistence: { ...ref, threadId: "root" }
    };

    await writeThread(thread);
    const restored = await readThread(ref, "root");

    expect(restored?.id).toBe("root");
    expect(restored?.status).toBe("running");
    expect(restored?.persistence).toEqual({ ...ref, threadId: "root" });
  });

  test("writes debug input and output files", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-persistable-"));
    const ref = await createFlowObject({
      baseDir: tempRoot,
      sessionId: "s1",
      objectId: "obj"
    });
    const threadRef = { ...ref, threadId: "root" };

    await writeDebugInput(threadRef, {
      threadId: "root",
      messages: [{ role: "system", content: "<context />" }],
      tools: []
    });
    await writeDebugOutput(threadRef, {
      threadId: "root",
      result: {
        provider: "openai",
        model: "test",
        text: "ok",
        toolCalls: []
      }
    });

    const paths = resolvePersistablePaths(threadRef);
    const input = JSON.parse(await readFile(paths.llmInputFile, "utf8"));
    const output = JSON.parse(await readFile(paths.llmOutputFile, "utf8"));

    expect(input.threadId).toBe("root");
    expect(output.result.text).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/persistable/__tests__/persistable.test.ts
```

Expected: FAIL because `src/persistable/index.ts` does not exist.

- [ ] **Step 3: Create persistable types**

Create `src/persistable/types.ts`:

```ts
import type { LlmGenerateResult, LlmMessage, LlmTool } from "../thinkable/llm/types";

/** Identifies the single flow object persisted on disk. */
export interface FlowObjectRef {
  /** Root directory that contains `flows/`. */
  baseDir: string;
  /** Session directory name under `flows/`. */
  sessionId: string;
  /** Object directory name under `flows/{sessionId}/objects/`. */
  objectId: string;
}

/** Identifies one persisted thread under a flow object. */
export interface ThreadPersistenceRef extends FlowObjectRef {
  /** Thread directory name under `threads/`. */
  threadId: string;
}

/** Metadata written to `.flow.json`. */
export interface FlowObjectMetadata {
  /** Discriminator for this metadata file. */
  type: "flow-object";
  /** Session ID copied from the flow object ref. */
  sessionId: string;
  /** Object ID copied from the flow object ref. */
  objectId: string;
}

/** Serializable LLM input debug payload. */
export interface LlmInputDebugRecord {
  /** Thread that produced this LLM input. */
  threadId: string;
  /** Messages sent to the provider. */
  messages: LlmMessage[];
  /** Tool definitions exposed to the provider. */
  tools: LlmTool[];
}

/** Serializable LLM output debug payload. */
export interface LlmOutputDebugRecord {
  /** Thread that received this LLM output. */
  threadId: string;
  /** Normalized provider result. */
  result: LlmGenerateResult;
}
```

- [ ] **Step 4: Create path resolver**

Create `src/persistable/paths.ts`:

```ts
import { join } from "node:path";
import type { FlowObjectRef, ThreadPersistenceRef } from "./types";

/** All paths needed by the single object persistable layer. */
export interface PersistablePaths {
  /** `flows/{sessionId}` directory. */
  sessionDir: string;
  /** `flows/{sessionId}/objects/{objectId}` directory. */
  objectDir: string;
  /** Flow object metadata file. */
  flowMetadataFile: string;
  /** `threads` directory under the flow object. */
  threadsDir: string;
  /** Concrete thread directory when threadId is present. */
  threadDir?: string;
  /** Concrete thread JSON file when threadId is present. */
  threadFile?: string;
  /** Concrete debug directory when threadId is present. */
  debugDir?: string;
  /** LLM input debug file when threadId is present. */
  llmInputFile?: string;
  /** LLM output debug file when threadId is present. */
  llmOutputFile?: string;
}

/** Resolve filesystem paths without touching disk. */
export function resolvePersistablePaths(ref: FlowObjectRef | ThreadPersistenceRef): PersistablePaths {
  const sessionDir = join(ref.baseDir, "flows", ref.sessionId);
  const objectDir = join(sessionDir, "objects", ref.objectId);
  const threadsDir = join(objectDir, "threads");
  const threadId = "threadId" in ref ? ref.threadId : undefined;
  const threadDir = threadId ? join(threadsDir, threadId) : undefined;
  const debugDir = threadDir ? join(threadDir, "debug") : undefined;

  return {
    sessionDir,
    objectDir,
    flowMetadataFile: join(objectDir, ".flow.json"),
    threadsDir,
    threadDir,
    threadFile: threadDir ? join(threadDir, "thread.json") : undefined,
    debugDir,
    llmInputFile: debugDir ? join(debugDir, "llm.input.json") : undefined,
    llmOutputFile: debugDir ? join(debugDir, "llm.output.json") : undefined
  };
}
```

- [ ] **Step 5: Create flow object initializer**

Create `src/persistable/flow-object.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { resolvePersistablePaths } from "./paths";
import type { FlowObjectMetadata, FlowObjectRef } from "./types";

/** Create the single flow object directory and write its metadata file. */
export async function createFlowObject(ref: FlowObjectRef): Promise<FlowObjectRef> {
  const paths = resolvePersistablePaths(ref);
  await mkdir(paths.threadsDir, { recursive: true });

  const metadata: FlowObjectMetadata = {
    type: "flow-object",
    sessionId: ref.sessionId,
    objectId: ref.objectId
  };

  await writeFile(paths.flowMetadataFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return ref;
}
```

- [ ] **Step 6: Create thread store**

Create `src/persistable/thread-store.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolvePersistablePaths } from "./paths";
import type { FlowObjectRef } from "./types";
import type { ThreadContext } from "../thinkable/context";

/** Persist one thread context to its `thread.json` file. */
export async function writeThread(thread: ThreadContext): Promise<void> {
  if (!thread.persistence) {
    return;
  }

  const paths = resolvePersistablePaths(thread.persistence);
  if (!paths.threadDir || !paths.threadFile) {
    return;
  }

  await mkdir(paths.threadDir, { recursive: true });
  await writeFile(paths.threadFile, `${JSON.stringify(thread, null, 2)}\n`, "utf8");
}

/** Read a thread context from disk and reattach its persistence ref. */
export async function readThread(ref: FlowObjectRef, threadId: string): Promise<ThreadContext | undefined> {
  const threadRef = { ...ref, threadId };
  const paths = resolvePersistablePaths(threadRef);
  if (!paths.threadFile) {
    return undefined;
  }

  try {
    const raw = await readFile(paths.threadFile, "utf8");
    const parsed = JSON.parse(raw) as ThreadContext;
    return {
      ...parsed,
      persistence: threadRef
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
```

- [ ] **Step 7: Create debug store**

Create `src/persistable/debug-store.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { resolvePersistablePaths } from "./paths";
import type { LlmInputDebugRecord, LlmOutputDebugRecord, ThreadPersistenceRef } from "./types";

/** Write the latest LLM input debug record for one thread. */
export async function writeDebugInput(ref: ThreadPersistenceRef, record: LlmInputDebugRecord): Promise<void> {
  const paths = resolvePersistablePaths(ref);
  if (!paths.debugDir || !paths.llmInputFile) {
    return;
  }

  await mkdir(paths.debugDir, { recursive: true });
  await writeFile(paths.llmInputFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/** Write the latest LLM output debug record for one thread. */
export async function writeDebugOutput(ref: ThreadPersistenceRef, record: LlmOutputDebugRecord): Promise<void> {
  const paths = resolvePersistablePaths(ref);
  if (!paths.debugDir || !paths.llmOutputFile) {
    return;
  }

  await mkdir(paths.debugDir, { recursive: true });
  await writeFile(paths.llmOutputFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}
```

- [ ] **Step 8: Export persistable API**

Create `src/persistable/index.ts`:

```ts
export { createFlowObject } from "./flow-object";
export { resolvePersistablePaths } from "./paths";
export { readThread, writeThread } from "./thread-store";
export { writeDebugInput, writeDebugOutput } from "./debug-store";
export type {
  FlowObjectMetadata,
  FlowObjectRef,
  LlmInputDebugRecord,
  LlmOutputDebugRecord,
  ThreadPersistenceRef
} from "./types";
```

- [ ] **Step 9: Add persistence ref to ThreadContext**

Modify `src/thinkable/context.ts`:

```ts
import type { ThreadPersistenceRef } from "../persistable/types";
```

Add this field to `ThreadContext`:

```ts
  /** 当前线程的持久化位置；缺失时系统只以内存模式运行。 */
  persistence?: ThreadPersistenceRef;
```

- [ ] **Step 10: Run tests**

Run:

```bash
bun test src/persistable/__tests__/persistable.test.ts
bunx tsc --noEmit
```

Expected: both commands exit with code `0`.

- [ ] **Step 11: Commit**

```bash
git add src/persistable src/thinkable/context.ts
git commit -m "feat: add single object persistence store"
```

---

### Task 3: Observable Debug Files

**Files:**
- Modify: `src/observable/index.ts`
- Test: `src/observable/__tests__/observable.test.ts`

- [ ] **Step 1: Extend observable test**

Add this test to `src/observable/__tests__/observable.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFlowObject, resolvePersistablePaths } from "../../persistable";

test("writes llm input and output debug files when thread is persistable", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-observable-"));
  try {
    const flowRef = await createFlowObject({
      baseDir,
      sessionId: "s1",
      objectId: "obj"
    });
    const thread = {
      id: "root",
      status: "running" as const,
      events: [],
      persistence: { ...flowRef, threadId: "root" }
    };

    await observableModule.writeLatestLlmInput(
      thread,
      [{ role: "system", content: "<context />" }],
      []
    );
    await observableModule.writeLatestLlmOutput(thread, {
      provider: "openai",
      model: "test",
      text: "done",
      toolCalls: []
    });

    const paths = resolvePersistablePaths(thread.persistence);
    const input = JSON.parse(await readFile(paths.llmInputFile!, "utf8"));
    const output = JSON.parse(await readFile(paths.llmOutputFile!, "utf8"));

    expect(input.messages[0].content).toBe("<context />");
    expect(output.result.text).toBe("done");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/observable/__tests__/observable.test.ts
```

Expected: FAIL because observable does not write debug files yet.

- [ ] **Step 3: Wire observable to persistable debug store**

Modify `src/observable/index.ts`:

```ts
import { writeDebugInput, writeDebugOutput } from "../persistable";
```

Update `writeLatestLlmInput()` after updating `latestLlmObservation`:

```ts
  if (thread.persistence) {
    await writeDebugInput(thread.persistence, {
      threadId: thread.id,
      messages,
      tools
    });
  }
```

Update `writeLatestLlmOutput()` after updating `latestLlmObservation`:

```ts
  if (thread.persistence) {
    await writeDebugOutput(thread.persistence, {
      threadId: thread.id,
      result
    });
  }
```

- [ ] **Step 4: Run observable tests**

Run:

```bash
bun test src/observable/__tests__/observable.test.ts
bunx tsc --noEmit
```

Expected: both commands exit with code `0`.

- [ ] **Step 5: Commit**

```bash
git add src/observable/index.ts src/observable/__tests__/observable.test.ts
git commit -m "feat: persist observable llm debug files"
```

---

### Task 4: Scheduler Persistence

**Files:**
- Modify: `src/thinkable/scheduler.ts`
- Test: `src/thinkable/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add failing scheduler persistence test**

Add this test to `src/thinkable/__tests__/scheduler.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFlowObject, resolvePersistablePaths } from "../../persistable";

test("persists a thread after it is executed", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "ooc-scheduler-"));
  try {
    const flowRef = await createFlowObject({
      baseDir,
      sessionId: "s1",
      objectId: "obj"
    });
    const root: ThreadContext = {
      id: "root",
      status: "running",
      events: [],
      persistence: { ...flowRef, threadId: "root" }
    };
    const llmClient: LlmClient = {
      async generate() {
        return {
          provider: "openai",
          model: "test",
          text: "persisted",
          toolCalls: []
        };
      },
      async *stream() {}
    };

    await runScheduler(root, llmClient, { maxTicks: 1 });

    const paths = resolvePersistablePaths(root.persistence!);
    const saved = JSON.parse(await readFile(paths.threadFile!, "utf8"));
    expect(saved.events[0].text).toBe("persisted");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/thinkable/__tests__/scheduler.test.ts
```

Expected: FAIL because scheduler does not write `thread.json`.

- [ ] **Step 3: Persist executed thread after each think**

Modify `src/thinkable/scheduler.ts`:

```ts
import { writeThread } from "../persistable";
```

Update the loop after `await think(nextThread, llmClient);`:

```ts
    await think(nextThread, llmClient);
    await writeThread(nextThread);
```

- [ ] **Step 4: Run scheduler tests**

Run:

```bash
bun test src/thinkable/__tests__/scheduler.test.ts
bunx tsc --noEmit
```

Expected: both commands exit with code `0`.

- [ ] **Step 5: Commit**

```bash
git add src/thinkable/scheduler.ts src/thinkable/__tests__/scheduler.test.ts
git commit -m "feat: persist scheduler thread ticks"
```

---

### Task 5: Single Object Runtime Test

**Files:**
- Create: `src/thinkable/__tests__/single-object-runtime.test.ts`
- Modify only if required by the test: `src/thinkable/scheduler.ts`, `src/observable/index.ts`, `src/persistable/*.ts`

- [ ] **Step 1: Write end-to-end single object test**

Create `src/thinkable/__tests__/single-object-runtime.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { createFlowObject, resolvePersistablePaths } from "../../persistable";
import type { ThreadContext } from "../context";
import type { LlmClient } from "../llm/types";
import { runScheduler } from "../scheduler";

describe("single object runtime", () => {
  test("runs thinkable, executable, observable, and persistable in one object", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-single-object-"));
    try {
      const flowRef = await createFlowObject({
        baseDir,
        sessionId: "s1",
        objectId: "assistant"
      });
      const root: ThreadContext = {
        id: "root",
        status: "running",
        events: [],
        activeForms: [],
        persistence: { ...flowRef, threadId: "root" }
      };
      const llmClient: LlmClient = {
        async generate() {
          return {
            provider: "openai",
            model: "test",
            text: "I will make a plan.",
            toolCalls: [
              {
                id: "tc1",
                name: "open",
                arguments: {
                  type: "command",
                  command: "plan",
                  description: "制定本对象执行计划",
                  args: { plan: "完成单 object 最小闭环" }
                }
              },
              {
                id: "tc2",
                name: "submit",
                arguments: {
                  title: "提交计划",
                  form_id: ""
                }
              }
            ]
          };
        },
        async *stream() {}
      };

      await runScheduler(root, llmClient, { maxTicks: 1 });

      const paths = resolvePersistablePaths(root.persistence!);
      const input = JSON.parse(await readFile(paths.llmInputFile!, "utf8"));
      const output = JSON.parse(await readFile(paths.llmOutputFile!, "utf8"));
      const savedThread = JSON.parse(await readFile(paths.threadFile!, "utf8"));

      expect(input.threadId).toBe("root");
      expect(output.result.toolCalls).toHaveLength(2);
      expect(savedThread.events.some((event: { kind: string }) => event.kind === "tool_use")).toBe(true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Adjust the test to avoid dynamic form id ambiguity**

Replace the LLM client in the test with a two-call client that first opens the form, then reads the generated form id from `root.activeForms`:

```ts
let callCount = 0;
const llmClient: LlmClient = {
  async generate() {
    callCount += 1;
    if (callCount === 1) {
      return {
        provider: "openai",
        model: "test",
        text: "I will open a plan form.",
        toolCalls: [
          {
            id: "tc1",
            name: "open",
            arguments: {
              type: "command",
              command: "plan",
              description: "制定本对象执行计划",
              args: { plan: "完成单 object 最小闭环" }
            }
          }
        ]
      };
    }

    return {
      provider: "openai",
      model: "test",
      text: "I will submit the plan.",
      toolCalls: [
        {
          id: "tc2",
          name: "submit",
          arguments: {
            title: "提交计划",
            form_id: root.activeForms?.[0]?.formId
          }
        }
      ]
    };
  },
  async *stream() {}
};
```

Run scheduler with two ticks:

```ts
await runScheduler(root, llmClient, { maxTicks: 2 });
```

Assert final plan:

```ts
expect(root.plan).toBe("完成单 object 最小闭环");
expect(savedThread.plan).toBe("完成单 object 最小闭环");
```

- [ ] **Step 3: Run end-to-end test**

Run:

```bash
bun test src/thinkable/__tests__/single-object-runtime.test.ts
```

Expected: PASS after Task 2-4 are complete.

- [ ] **Step 4: Run all relevant tests**

Run:

```bash
bun test src/thinkable/__tests__ src/executable/__tests__ src/observable/__tests__ src/persistable/__tests__
bunx tsc --noEmit
```

Expected: tests pass, TypeScript exits with code `0`.

- [ ] **Step 5: Commit**

```bash
git add src/thinkable/__tests__/single-object-runtime.test.ts
git commit -m "test: cover single object runtime loop"
```

---

### Task 6: Talk Boundary Hardening

**Files:**
- Modify: `src/executable/commands/talk.ts`
- Test: `src/executable/__tests__/commands-execution.test.ts`

- [ ] **Step 1: Add failing talk boundary test**

Add this test to `src/executable/__tests__/commands-execution.test.ts`:

```ts
test("talk should be an explicit non-goal in the single object phase", async () => {
  const thread: ThreadContext = {
    id: "root",
    status: "running",
    events: []
  };

  await executeCommand("talk", {
    thread,
    args: {
      target: "another-object",
      msg: "hello"
    }
  });

  expect(thread.events.at(-1)).toEqual({
    category: "context_change",
    kind: "inject",
    text: "[talk] 多 object 交互不属于当前单 object 阶段。"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test src/executable/__tests__/commands-execution.test.ts --test-name-pattern "talk should"
```

Expected: FAIL because `executeTalkCommand()` is currently a no-op.

- [ ] **Step 3: Implement explicit talk boundary**

Modify `src/executable/commands/talk.ts`:

```ts
/** 执行 talk command；本阶段明确不实现多 object 交互。 */
export async function executeTalkCommand(ctx: CommandExecutionContext): Promise<void> {
  ctx.thread?.events.push({
    category: "context_change",
    kind: "inject",
    text: "[talk] 多 object 交互不属于当前单 object 阶段。"
  });
}
```

- [ ] **Step 4: Run executable tests**

Run:

```bash
bun test src/executable/__tests__
bunx tsc --noEmit
```

Expected: both commands exit with code `0`.

- [ ] **Step 5: Commit**

```bash
git add src/executable/commands/talk.ts src/executable/__tests__/commands-execution.test.ts
git commit -m "feat: make talk boundary explicit"
```

---

### Task 7: Final Verification And Documentation Scan

**Files:**
- Modify only if scan reveals mismatch: `meta/**/*.doc.js`, `src/**/*.ts`

- [ ] **Step 1: Run declaration comment scan**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import re
root=Path('src')
pat=re.compile(r'^(export\s+)?(async\s+)?(function|class|interface|type|enum)\s+|^export\s+const\s+\w+\s*[:=]|^const\s+[A-Z_]+\s*[:=]|^function\s+')
missing=[]
for p in sorted(root.rglob('*.ts')):
    if '__tests__' in p.parts:
        continue
    lines=p.read_text().splitlines()
    for i,l in enumerate(lines):
        if not pat.match(l.strip()):
            continue
        j=i-1
        while j>=0 and not lines[j].strip():
            j-=1
        prev=lines[j].strip() if j>=0 else ''
        if not (prev.startswith('/**') or prev.startswith('*') or prev.startswith('*/') or prev.startswith('//')):
            missing.append(f'{p}:{i+1}: {l.strip()}')
print('\n'.join(missing))
PY
```

Expected: no output.

- [ ] **Step 2: Run source/doc alignment scan**

Run:

```bash
grep -R "sources:" -n meta/object | sort
```

Expected: persistable、observable、thinkable、executable 相关文档均包含本阶段实现文件的 source binding。

- [ ] **Step 3: Run full test suite**

Run:

```bash
bun test
bunx tsc --noEmit
```

Expected: `bun test` has no failed tests; `bunx tsc --noEmit` exits with code `0`.

- [ ] **Step 4: Review changed files**

Run:

```bash
git diff --stat
git diff -- src/persistable src/observable src/thinkable src/executable meta/object/persistable meta/object/observable meta/object/thinkable
```

Expected: changes only implement the single object scope described in this plan. No multi object talk routing, server/client execution, or compress execution appears in the diff.

- [ ] **Step 5: Commit final cleanup**

```bash
git add meta/object src
git commit -m "chore: verify single object core alignment"
```

---

## Self-Review

- Spec coverage: thinkable 由 scheduler/thinkloop 测试覆盖，executable 由 tools/commands 测试覆盖，observable 由 debug 文件测试覆盖，persistable 由 flow/thread/debug store 测试覆盖。
- Scope control: 多 object `talk`、`compress`、server/client、stone/flow 合并均明确排除或占位提示。
- Type consistency: `ThreadPersistenceRef` 只作为 `ThreadContext.persistence` 的可选运行时引用；无 persistence 的线程继续以内存模式运行。
- Verification: 每个任务都有先失败后通过的测试命令，最后以 `bun test` 与 `bunx tsc --noEmit` 收敛。
