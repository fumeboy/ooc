# Current Thinkable Doc Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让当前已经编写的 `thinkable` / `executable` 核心代码与新版 `meta/*.doc.js` 文档重新对齐，避免继续产生“文档里没有的代码”或“代码里没有的文档”。

**Architecture:** 新版 `meta` 文档是架构约束入口，源码通过 `sources` 显式挂到对应文档节点。先补齐文档到源码的引用关系，再用小测试锁定当前实现与文档不一致的地方，最后按新版文档收敛运行时状态，尤其是 `todo` 只作为 `activeForms` 生命周期存在，不再作为 `ThreadContext.todos` 独立窗口。

**Tech Stack:** TypeScript, Bun test, doc.js meta docs, existing thinkable/executable modules

---

## 当前状态

- `meta/object/thinkable/context/index.doc.js` 定义 `Context = system 信息窗口 + process event messages`，但没有显式 `sources` 引用 `src/thinkable/context.ts`。
- `src/thinkable/context.ts` 已实现 XML system context、inbox/outbox、activeForms、process events，但还保留了 `ThreadTodo` 与 `<todos>` 渲染，和新版文档“todo 归并到 form”冲突。
- `src/executable/commands/todo.ts` 当前会把 submit 后的 todo 写入 `thread.todos`，和新版文档“未 submit 的 todo form 持续出现在 activeForms；submit 后关闭”冲突。
- `src/executable/commands/do.ts` 已实现 fork/continue、inbox/outbox、wait=true，但 fork 子线程尚未自动注入“处理初始消息”的 todo form。
- `src/thinkable/scheduler.ts` 已能唤醒 `await_children`，但调度顺序仍是当前树遍历第一个 running 线程，不符合 scheduler 文档中的 `lastExecutedAt` 公平策略。

## 非目标

- 不实现跨 Object 的 `talk` 路由。
- 不实现 `compress` tool。
- 不实现 persistable 落盘。
- 不实现完整 deadlock 兜底，只在文档中标明本轮未覆盖。
- 不迁移旧系统中未被新版文档明确覆盖的机制。

---

### Task 1: 补齐 Thinkable 文档到源码的显式绑定

**Files:**
- Modify: `meta/object/thinkable/context/index.doc.js`
- Modify: `meta/object/thinkable/thread/index.doc.js`
- Modify: `meta/object/thinkable/thread/scheduler.doc.js`

- [ ] **Step 1: 修改 context 文档，引入实际源码**

在 `meta/object/thinkable/context/index.doc.js` 顶部加入源码引用，并在导出对象中加入 `sources`：

```js
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as contextSource from "@src/thinkable/context";
import * as contextTestSource from "@src/thinkable/__tests__/context.test";

export const context_v20260505_1 = {
  parent: thinkable_v20260504_1,
  sources: {
    context: contextSource,
    tests: contextTestSource,
  },
  index: `
Context 是 Object 每次思考时看到的全部信息。
```

- [ ] **Step 2: 修改 thread 文档，引入 ThreadContext 相关源码**

在 `meta/object/thinkable/thread/index.doc.js` 顶部加入：

```js
import { thinkable_v20260504_1 } from "@meta/object/thinkable/index.doc";
import * as contextSource from "@src/thinkable/context";
import * as doCommandSource from "@src/executable/commands/do";
import * as doThreadTreeTestSource from "@src/executable/__tests__/do-thread-tree.test";
```

在 `thread_v20260505_1` 中加入：

```js
export const thread_v20260505_1 = {
  parent: thinkable_v20260504_1,
  sources: {
    context: contextSource,
    doCommand: doCommandSource,
    tests: doThreadTreeTestSource,
  },
  index: `
Thread 描述 Object 思考的运行时结构。
```

- [ ] **Step 3: 修改 scheduler 文档，引入调度器源码**

在 `meta/object/thinkable/thread/scheduler.doc.js` 顶部加入：

```js
import { thread_v20260505_1 } from "@meta/object/thinkable/thread/index.doc";
import { object_v20260504_1 } from "@meta/object/index.doc";
import * as schedulerSource from "@src/thinkable/scheduler";
import * as schedulerTestSource from "@src/thinkable/__tests__/scheduler.test";
```

在 `scheduler_v20260505_1` 中加入：

```js
export const scheduler_v20260505_1 = {
  parent: thread_v20260505_1,
  sources: {
    scheduler: schedulerSource,
    tests: schedulerTestSource,
  },
  index: `
Scheduler 描述线程树的调度策略：每轮选哪个线程执行、何时唤醒等待中的线程、如何检测死锁。
```

- [ ] **Step 4: 验证文档源码引用可被 TypeScript 解析**

Run: `bunx tsc --noEmit`

Expected: exit code `0`，没有 `Cannot find module '@src/...'` 或循环初始化报错。

- [ ] **Step 5: Commit**

```bash
git add meta/object/thinkable/context/index.doc.js meta/object/thinkable/thread/index.doc.js meta/object/thinkable/thread/scheduler.doc.js
git commit -m "docs: bind thinkable docs to current sources"
```

---

### Task 2: 按新版 Context 文档移除独立 todos 窗口

**Files:**
- Modify: `src/thinkable/context.ts`
- Modify: `src/thinkable/__tests__/context.test.ts`
- Modify: `src/thinkable/__tests__/thinkloop.test.ts`
- Modify: `src/executable/__tests__/commands-execution.test.ts`

- [ ] **Step 1: 写失败测试，证明 todo 只通过 activeForms 进入 Context**

替换 `src/thinkable/__tests__/context.test.ts` 中关于 `<todos>` 的断言：

```ts
it("renders active todo forms but does not render a standalone todos window", async () => {
  const thread: ThreadContext = {
    id: "t_todo_form",
    status: "running",
    events: [],
    activeForms: [
      {
        formId: "f_todo",
        command: "todo",
        description: "处理初始消息",
        createdAt: 1,
        accumulatedArgs: {
          content: "处理用户的初始请求",
          on_command_path: ["do.fork"],
        },
        commandPaths: ["todo", "todo.on_command_path"],
        loadedKnowledgePaths: [],
      },
    ],
  };

  const messages = await buildContext(thread);

  expect(messages[0]?.content).toContain("<active_forms>");
  expect(messages[0]?.content).toContain('<form id="f_todo">');
  expect(messages[0]?.content).toContain("<command>todo</command>");
  expect(messages[0]?.content).toContain("处理用户的初始请求");
  expect(messages[0]?.content).not.toContain("<todos>");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/thinkable/__tests__/context.test.ts`

Expected: FAIL because `context.ts` still renders `<todos>` when `ThreadContext.todos` exists and tests still expect `<todos>`.

- [ ] **Step 3: 删除 ThreadTodo 与 todos 渲染**

在 `src/thinkable/context.ts` 中删除 `ThreadTodo` 类型、`todos?: ThreadTodo[]` 字段、`renderTodos()` 函数，以及 `buildContext()` 中的 `renderTodos(thread.todos)`。

`ThreadContext` 保留如下字段：

```ts
export type ThreadContext = {
  id: string;
  status: "running" | "waiting" | "done" | "failed" | "paused";
  events: ProcessEvent[];
  parentThreadId?: string;
  creatorThreadId?: string;
  childThreadIds?: string[];
  childThreads?: Record<string, ThreadContext>;
  inbox?: ThreadMessage[];
  outbox?: ThreadMessage[];
  plan?: string;
  activeForms?: ActiveForm[];
  activatedKnowledge?: string[];
  pinnedKnowledge?: string[];
  windows?: Record<
    string,
    {
      type: "knowledge" | "file";
      path: string;
      description: string;
      lines?: unknown;
      columns?: unknown;
    }
  >;
  waitingType?: "explicit_wait" | "talk_sync" | "await_children";
  awaitingChildren?: string[];
  endReason?: string;
  endSummary?: string;
  lastExecutedAt?: number;
};
```

- [ ] **Step 4: 让 activeForms 渲染 commandPaths 与 loadedKnowledgePaths**

修改 `renderActiveForms()`，让 Context 能反映 form 当前路径，支撑新版文档“根据 command path 激活 knowledge”的说明：

```ts
function renderActiveForms(activeForms: ActiveForm[] | undefined): string {
  if (!activeForms || activeForms.length === 0) return "";

  const items = activeForms
    .map((form) => {
      const commandPaths = form.commandPaths.length
        ? `<command_paths>${form.commandPaths
            .map((path) => `<path>${escapeXml(path)}</path>`)
            .join("")}</command_paths>`
        : "";
      const loadedKnowledge = form.loadedKnowledgePaths.length
        ? `<loaded_knowledge>${form.loadedKnowledgePaths
            .map((path) => `<path>${escapeXml(path)}</path>`)
            .join("")}</loaded_knowledge>`
        : "";

      return [
        `<form id="${escapeXml(form.formId)}">`,
        `<command>${escapeXml(form.command)}</command>`,
        `<description>${escapeXml(form.description)}</description>`,
        `<accumulated_args>${escapeXml(JSON.stringify(form.accumulatedArgs))}</accumulated_args>`,
        commandPaths,
        loadedKnowledge,
        "</form>",
      ].join("");
    })
    .join("");

  return `<active_forms>${items}</active_forms>`;
}
```

- [ ] **Step 5: 更新受影响测试**

把所有 `thread.todos` 断言改为 `thread.activeForms` 或删除独立 todo 断言。

在 `src/thinkable/__tests__/thinkloop.test.ts` 中，把 submit todo 后的断言改为：

```ts
expect(thread.activeForms).toEqual([]);
expect(thread.events.at(-1)).toEqual({
  category: "context_change",
  kind: "inject",
  text: expect.stringContaining("[submit] Form"),
});
```

在 `src/executable/__tests__/commands-execution.test.ts` 中删除 `executeTodoCommand()` 写入 `thread.todos` 的断言，改用 form 生命周期测试覆盖 todo 可见性。

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/thinkable/__tests__/context.test.ts src/thinkable/__tests__/thinkloop.test.ts src/executable/__tests__/commands-execution.test.ts`

Expected: PASS，Context 中没有 `<todos>`，todo 待办只通过 `activeForms` 暴露。

- [ ] **Step 7: Commit**

```bash
git add src/thinkable/context.ts src/thinkable/__tests__/context.test.ts src/thinkable/__tests__/thinkloop.test.ts src/executable/__tests__/commands-execution.test.ts
git commit -m "refactor: represent todos only as active forms"
```

---

### Task 3: 收敛 todo command 为 form 关闭语义

**Files:**
- Modify: `src/executable/commands/todo.ts`
- Modify: `src/executable/__tests__/commands-execution.test.ts`
- Modify: `meta/object/executable/actions/commands/todo.doc.js`

- [ ] **Step 1: 写失败测试，证明 submit todo 不产生独立状态**

在 `src/executable/__tests__/commands-execution.test.ts` 中加入：

```ts
it("todo command relies on form lifecycle and does not write standalone thread todos", async () => {
  const thread: ThreadContext = {
    id: "t_todo",
    status: "running",
    events: [],
  };

  await executeCommand("todo", {
    thread,
    args: {
      content: "处理初始消息",
      on_command_path: ["do.fork"],
    },
  });

  expect("todos" in thread).toBe(false);
  expect(thread.activeForms).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/__tests__/commands-execution.test.ts`

Expected: FAIL because `executeTodoCommand()` currently writes `ctx.thread.todos`.

- [ ] **Step 3: 简化 todo command 执行函数**

修改 `src/executable/commands/todo.ts`，让 todo 的“存在”完全由 form 管理，submit 后不再额外沉淀运行时状态：

```ts
export async function executeTodoCommand(_ctx: CommandExecutionContext): Promise<void> {
  return;
}
```

- [ ] **Step 4: 更新 todo 文档，说明 submit 即关闭待办**

在 `meta/object/executable/actions/commands/todo.doc.js` 的 index 文本中写明：

```js
## 运行时语义

todo 不写入 ThreadContext.todos。
todo 的可见性来自 activeForms：
- open(command=todo) 后，form 出现在 activeForms，表示待办未完成
- refine(form_id, ...) 更新待办内容和触发条件
- submit(form_id) 消费并关闭 form，表示待办已处理
- close(form_id, reason) 放弃该待办
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/executable/__tests__/commands-execution.test.ts src/thinkable/__tests__/thinkloop.test.ts`

Expected: PASS，todo submit 不再写入独立 `todos` 字段。

- [ ] **Step 6: Commit**

```bash
git add src/executable/commands/todo.ts src/executable/__tests__/commands-execution.test.ts meta/object/executable/actions/commands/todo.doc.js
git commit -m "refactor: make todo command form-only"
```

---

### Task 4: do(fork) 创建子线程时注入初始 todo form

**Files:**
- Modify: `src/executable/commands/do.ts`
- Modify: `src/executable/__tests__/do-thread-tree.test.ts`
- Modify: `src/thinkable/__tests__/scheduler.test.ts`

- [ ] **Step 1: 写失败测试，锁定子线程初始 todo form**

在 `src/executable/__tests__/do-thread-tree.test.ts` 中加入：

```ts
it("fork creates an initial todo form in the child thread", async () => {
  const parent: ThreadContext = {
    id: "t_parent",
    status: "running",
    events: [],
  };

  await executeCommand("do", {
    thread: parent,
    args: {
      context: "fork",
      msg: "请检查日志",
    },
  });

  const childId = parent.childThreadIds?.[0] ?? "";
  const child = parent.childThreads?.[childId];

  expect(child?.activeForms).toHaveLength(1);
  expect(child?.activeForms?.[0]?.command).toBe("todo");
  expect(child?.activeForms?.[0]?.description).toBe("处理初始消息");
  expect(child?.activeForms?.[0]?.accumulatedArgs).toEqual({
    content: "请检查日志",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/__tests__/do-thread-tree.test.ts`

Expected: FAIL because fork 子线程当前只有 inbox，没有自动创建 todo form。

- [ ] **Step 3: 在 do.ts 中复用 FormManager 创建初始 todo**

在 `src/executable/commands/do.ts` 顶部加入：

```ts
import { FormManager } from "../forms/form.js";
```

加入 helper：

```ts
function createInitialTodoForms(content: string): ActiveForm[] {
  const formManager = new FormManager();
  const formId = formManager.begin("todo", "处理初始消息");
  formManager.applyRefine(formId, { content });
  return formManager.toData();
}
```

如果 `ActiveForm` 类型未导入，加入：

```ts
import type { ActiveForm } from "../forms/form.js";
```

创建 child thread 时填入：

```ts
const childThread: ThreadContext = {
  id: childId,
  status: "running",
  events: [],
  parentThreadId: parentThread.id,
  creatorThreadId: ctx.thread.id,
  inbox: [message],
  activeForms: createInitialTodoForms(content),
};
```

- [ ] **Step 4: 更新 scheduler 测试，按 form-only todo 提交子线程**

在 `src/thinkable/__tests__/scheduler.test.ts` 中，子线程第一轮若已有 todo form，不再先 open end form；测试可以继续通过 open/refine/submit end 完成子线程，但不得依赖 `thread.todos`。

使用以下断言补充 fork 后状态：

```ts
expect(parent.childThreads?.t_child?.activeForms?.[0]?.command).toBe("todo");
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/executable/__tests__/do-thread-tree.test.ts src/thinkable/__tests__/scheduler.test.ts`

Expected: PASS，fork 子线程具备初始 inbox 和初始 todo form。

- [ ] **Step 6: Commit**

```bash
git add src/executable/commands/do.ts src/executable/__tests__/do-thread-tree.test.ts src/thinkable/__tests__/scheduler.test.ts
git commit -m "feat: seed child threads with initial todo form"
```

---

### Task 5: 按 scheduler 文档改为 lastExecutedAt 公平选择

**Files:**
- Modify: `src/thinkable/scheduler.ts`
- Modify: `src/thinkable/__tests__/scheduler.test.ts`
- Modify: `meta/object/thinkable/thread/scheduler.doc.js`

- [ ] **Step 1: 写失败测试，证明最久未执行的 running 线程优先**

在 `src/thinkable/__tests__/scheduler.test.ts` 中加入：

```ts
it("runs the oldest running thread first by lastExecutedAt", async () => {
  const childOld: ThreadContext = {
    id: "t_old",
    status: "running",
    events: [],
    lastExecutedAt: 10,
  };
  const childNew: ThreadContext = {
    id: "t_new",
    status: "running",
    events: [],
    lastExecutedAt: 20,
  };
  const root: ThreadContext = {
    id: "t_root",
    status: "waiting",
    events: [],
    childThreads: {
      t_new: childNew,
      t_old: childOld,
    },
  };
  const executed: string[] = [];
  const llmClient: LlmClient = {
    async generate({ messages }) {
      const system = messages[0]?.content ?? "";
      if (system.includes('id="t_old"')) executed.push("t_old");
      if (system.includes('id="t_new"')) executed.push("t_new");
      return {
        provider: "openai",
        model: "gpt-test",
        text: "",
        toolCalls: [],
      };
    },
    async *stream() {
      yield { type: "start", provider: "openai", model: "gpt-test" };
      yield { type: "done", text: "", toolCalls: [] };
    },
  };

  await runScheduler(root, llmClient, { maxTicks: 1 });

  expect(executed).toEqual(["t_old"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/thinkable/__tests__/scheduler.test.ts`

Expected: FAIL because current scheduler picks the first running thread in traversal order.

- [ ] **Step 3: 修改调度选择逻辑**

在 `src/thinkable/scheduler.ts` 中加入：

```ts
function selectNextThread(threads: ThreadContext[]): ThreadContext {
  return [...threads].sort((a, b) => {
    const left = a.lastExecutedAt ?? 0;
    const right = b.lastExecutedAt ?? 0;
    if (left !== right) return left - right;
    return a.id.localeCompare(b.id);
  })[0]!;
}
```

替换 `runScheduler()` 中的选择代码：

```ts
const nextThread = selectNextThread(runningThreads);
nextThread.lastExecutedAt = Date.now();
await think(nextThread, llmClient);
```

- [ ] **Step 4: 在 scheduler 文档中标明本轮覆盖范围**

在 `meta/object/thinkable/thread/scheduler.doc.js` 的 `## 死锁检测` 前加入：

```js
## 当前实现范围

当前源码实现并测试：
- 每个 tick 只执行一个 running thread
- running thread 按 lastExecutedAt 从小到大选择
- waitingType=await_children 的父线程在子线程 done/failed 后恢复 running

当前源码暂未实现：
- talk_sync / explicit_wait 的 inbox 唤醒
- 全局 deadlock 检测与强制唤醒
- super flow 调度
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/thinkable/__tests__/scheduler.test.ts`

Expected: PASS，最久未执行线程优先。

- [ ] **Step 6: Commit**

```bash
git add src/thinkable/scheduler.ts src/thinkable/__tests__/scheduler.test.ts meta/object/thinkable/thread/scheduler.doc.js
git commit -m "feat: schedule oldest running thread first"
```

---

### Task 6: 全量收敛验证

**Files:**
- Verify: `meta/object/thinkable/**/*.doc.js`
- Verify: `src/thinkable/**`
- Verify: `src/executable/**`

- [ ] **Step 1: 运行 thinkable 与 executable 测试**

Run: `bun test src/thinkable/__tests__ src/executable/__tests__`

Expected: PASS，`0 fail`。

- [ ] **Step 2: 运行 TypeScript 检查**

Run: `bunx tsc --noEmit`

Expected: exit code `0`。

- [ ] **Step 3: 检查 Context 输出不再出现独立 todos**

Run: `bun test src/thinkable/__tests__/context.test.ts`

Expected: PASS，测试中包含 `not.toContain("<todos>")`。

- [ ] **Step 4: 检查未被本轮迁移的文档能力没有被误实现**

Run: `grep -R "compress" src/thinkable src/executable | cat`

Expected: 仅出现 schema/doc/test 允许的引用，不应出现新的 `handleCompressTool()` 或 command 执行实现。

- [ ] **Step 5: Commit verification-only changes if needed**

```bash
git add docs/superpowers/plans/2026-05-10-current-thinkable-doc-alignment.md
git commit -m "docs: plan current thinkable doc alignment"
```

---

## 自查结果

- Spec coverage: 已覆盖 `goal.md` 中“文档先行”“文档与源码强绑定”“避免孤儿文档/代码”“小步迁移”“未定义内容不脑补”的要求。
- 当前代码覆盖: 已覆盖 `context.ts`、`thinkloop.ts`、`scheduler.ts`、`do.ts`、`todo.ts` 这些当前已编写且与新版文档直接相关的部分。
- 明确取舍: 本计划删除独立 `todos` 概念，保留 `activeForms` 作为 todo 可见性来源；不迁移 `talk`、`compress`、持久化与 deadlock 兜底。
- Placeholder scan: 未发现空泛待填步骤、泛化实现描述或跨任务省略写法。
- Type consistency: 计划中的 `ThreadContext`、`ActiveForm`、`waitingType`、`lastExecutedAt`、`executeTodoCommand()` 名称与当前源码一致。
