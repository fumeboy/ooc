# Todo Command Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `open(type=todo)` and `defer` with a unified `todo` command that can carry visible todo content plus optional command/path-based reminders.

**Architecture:** Move todo creation into the existing command/form flow so all actionable items are opened through `open(type=command, command=...)`. Keep the runtime behavior minimal for now: register `todo` as a command, remove `defer`, and preserve reminder semantics in command metadata and tests without expanding execution logic beyond current placeholders.

**Tech Stack:** TypeScript, Bun test, Bun runtime, doc.js meta docs

---

### Task 1: Lock The New Command Surface With Failing Tests

**Files:**
- Modify: `src/executable/__tests__/commands.test.ts`
- Modify: `src/executable/__tests__/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { KNOWLEDGE as TODO_KNOWLEDGE } from "../commands/todo";

expect(Object.keys(COMMAND_TABLE)).toContain("todo");
expect(Object.keys(COMMAND_TABLE)).not.toContain("defer");
expect(getOpenableCommands()).toEqual(["do", "end", "plan", "program", "talk", "todo"]);

const knowledges = [
  TALK_KNOWLEDGE,
  DO_KNOWLEDGE,
  PROGRAM_KNOWLEDGE,
  PLAN_KNOWLEDGE,
  TODO_KNOWLEDGE,
  END_KNOWLEDGE
];

await dispatchToolCall(thread, {
  id: "call_1",
  name: "open",
  arguments: {
    type: "command",
    command: "todo",
    description: "登记待办",
    args: { content: "补测试", on_command: ["program"] }
  }
});

expect(thread.activeForms?.[0]?.command).toBe("todo");
expect(thread.activeForms?.[0]?.accumulatedArgs).toEqual({
  content: "补测试",
  on_command: ["program"]
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/executable/__tests__/commands.test.ts src/executable/__tests__/tools.test.ts`
Expected: FAIL because `todo` command file/module is missing and current tests still expect `defer` and `open(type=todo)`.

- [ ] **Step 3: Implement the minimal production changes**

```ts
// src/executable/commands/todo.ts
export const KNOWLEDGE = `
todo 用于登记一个可见待办，并可选配置在特定 command 或 command path 命中时提醒。
...
`;

export enum TodoCommandPath {
  Todo = "todo",
  OnCommand = "todo.on_command",
  OnPath = "todo.on_path",
}

export const todoCommand: CommandTableEntry = {
  paths: [TodoCommandPath.Todo, TodoCommandPath.OnCommand, TodoCommandPath.OnPath],
  match: (args) => {
    const hit = [TodoCommandPath.Todo];
    if (Array.isArray(args.on_command) && args.on_command.length > 0) hit.push(TodoCommandPath.OnCommand);
    if (Array.isArray(args.on_path) && args.on_path.length > 0) hit.push(TodoCommandPath.OnPath);
    return hit;
  },
};
```

```ts
// src/executable/commands/index.ts
import { executeTodoCommand, todoCommand } from "./todo.js";

export const COMMAND_TABLE = {
  talk: talkCommand,
  do: doCommand,
  program: programCommand,
  plan: planCommand,
  todo: todoCommand,
  end: endCommand,
};

case "todo":
  return executeTodoCommand(ctx);
```

```ts
// src/executable/tools/open.ts
enum: ["command", "knowledge", "file"]
if (openType === "command") {
  const command = args.command as string;
  const formId = formManager.begin(command, description);
  formManager.applyRefine(formId, nestedArgs);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/executable/__tests__/commands.test.ts src/executable/__tests__/tools.test.ts`
Expected: PASS with `todo` replacing `defer` and no `open(type=todo)` coverage remaining.

- [ ] **Step 5: Commit**

```bash
git add src/executable/commands/todo.ts src/executable/commands/index.ts src/executable/tools/open.ts src/executable/__tests__/commands.test.ts src/executable/__tests__/tools.test.ts
git commit -m "feat: unify todo into command flow"
```

### Task 2: Update Docs And Remove The Old Entry

**Files:**
- Delete: `src/executable/commands/defer.ts`
- Modify: `meta/object/executable/actions/commands/index.doc.js`
- Create: `meta/object/executable/actions/commands/todo.doc.js`
- Delete: `meta/object/executable/actions/commands/defer.doc.js`
- Modify: `meta/object/executable/actions/tools/open.doc.js`

- [ ] **Step 1: Write the failing doc/reference expectations**

```ts
expect(Object.keys(COMMAND_TABLE)).not.toContain("defer");
expect(getOpenableCommands()).not.toContain("defer");
expect(getOpenableCommands()).toContain("todo");
```

- [ ] **Step 2: Run command tests to verify the old references are still visible**

Run: `bun test src/executable/__tests__/commands.test.ts`
Expected: FAIL until docs/source references and command imports are fully aligned around `todo`.

- [ ] **Step 3: Update doc.js references and delete the old command**

```js
// meta/object/executable/actions/commands/index.doc.js
| todo     | 登记一个可见待办，可选在命中特定 command/path 时提醒 |

- [todo](./todo.doc.js) — 可见待办与条件提醒
```

```js
// meta/object/executable/actions/tools/open.doc.js
| command   | 开始一次 command 调用，分配 form_id | 是 |
| knowledge | 显式打开一篇 knowledge，让其进入 Context | 否 |
| file      | 把一个文件的内容注入 Context | 否 |
```

- [ ] **Step 4: Run docs-adjacent tests to verify source alignment**

Run: `bun test src/executable/__tests__/commands.test.ts src/executable/__tests__/tools.test.ts`
Expected: PASS after all references move from `defer`/`open(type=todo)` to `todo command`.

- [ ] **Step 5: Commit**

```bash
git add meta/object/executable/actions/commands/index.doc.js meta/object/executable/actions/commands/todo.doc.js meta/object/executable/actions/tools/open.doc.js
git rm meta/object/executable/actions/commands/defer.doc.js src/executable/commands/defer.ts
git commit -m "docs: replace defer with todo command"
```

### Task 3: Full Verification

**Files:**
- Verify only: `src/executable/**`

- [ ] **Step 1: Run the executable test suite**

Run: `bun test src/executable/__tests__`
Expected: PASS with `32+` passing tests and `0 fail`.

- [ ] **Step 2: Run TypeScript verification**

Run: `bunx tsc --noEmit`
Expected: exit code `0`

- [ ] **Step 3: Inspect diagnostics for touched files**

Run checks for:
- `src/executable/commands/todo.ts`
- `src/executable/commands/index.ts`
- `src/executable/tools/open.ts`
- `src/executable/__tests__/commands.test.ts`
- `src/executable/__tests__/tools.test.ts`

Expected: no diagnostics

- [ ] **Step 4: Commit verification-only updates if needed**

```bash
git add -A
git commit -m "test: verify todo command unification"
```
