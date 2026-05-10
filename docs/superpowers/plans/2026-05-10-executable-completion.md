# OOC Executable Completion & Integration Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 OOC executable 层补齐到最小 ReAct 闭环（form lifecycle 重构 + program.shell 落地 + do.continue+wait 对称补全），并新建真 LLM 驱动的端到端集成测试套件覆盖 9 个场景。

**Architecture:** 在不引入新模块层的前提下，扩展 ActiveForm 与 FormManager 让 form 同时承载 status / result；handleSubmitTool 把执行流拆成"submit→executing→执行→executed"三段并 inject 三个事件；program.shell 用 Bun.spawn 跑命令并把归一化字符串赋给 form.result；集成测试与单元测试并存，用 OOC_API_KEY 环境变量做 skipIf 门控。

**Tech Stack:** TypeScript, Bun (test/spawn), 现有 thinkable / scheduler / persistable 模块, Claude API 代理。

---

## File Structure

| 文件 | 类型 | 责任 |
|---|---|---|
| `src/executable/forms/form.ts` | Modify | ActiveForm 加 status/result；FormManager.refine/submit 加 status guard；新增 markExecuted；fromData 兼容 status 缺省 |
| `src/executable/tools/refine.ts` | Modify | refine 失败时区分"不存在"和"非 open 状态"两种错误注入 |
| `src/executable/tools/submit.ts` | Modify | 重写流程：submit → 注入 executing → executeCommand → markExecuted → 注入 executed |
| `src/executable/commands/index.ts` | Modify | executeCommand 签名 `Promise<void>` → `Promise<string \| undefined>` |
| `src/executable/commands/program.ts` | Modify | 实现 executeProgramCommand（shell-only，30s timeout，4KB 截断）|
| `src/executable/commands/{plan,todo,do,end,talk}.ts` | Modify | 显式 `return undefined` 以匹配新签名；do.ts 的 continue 分支补 wait 处理 |
| `src/thinkable/context.ts` | Modify | renderActiveForms 加 status 属性 + 条件 result 段 |
| `src/executable/__tests__/forms.test.ts` | Modify | 更新两个老测试以匹配新生命周期 |
| `src/thinkable/__tests__/thinkloop.test.ts` | Modify | submit 后断言改成 form executed 而非 form 消失 |
| `src/executable/__tests__/program.test.ts` | Create | program.shell 4 个错误路径单元测试 |
| `meta/object/executable/index.doc.js` | Modify | "渐进式披露"段更新生命周期描述 |
| `meta/object/executable/actions/commands/program.doc.js` | Modify | 加"当前实现阶段"段 |
| `meta/object/executable/actions/commands/do.doc.js` | Modify | 补 continue+wait 示例 |
| `tsconfig.json` | Modify | `include` 加 `tests/**/*.ts` |
| `tests/integration/_fixture.ts` | Create | hasLlmEnv 探测 / setupTempFlow / makeRootThread / countEventsWithPrefix 通用 helper |
| `tests/integration/shell-exec-basic.integration.test.ts` | Create | 场景 1 |
| `tests/integration/plan-then-execute.integration.test.ts` | Create | 场景 2 |
| `tests/integration/multi-shell-chain.integration.test.ts` | Create | 场景 3 |
| `tests/integration/abandon-via-close.integration.test.ts` | Create | 场景 4 |
| `tests/integration/do-fork-and-collect.integration.test.ts` | Create | 场景 5 |
| `tests/integration/wait-state-transition.integration.test.ts` | Create | 场景 6 |
| `tests/integration/executed-form-cleanup.integration.test.ts` | Create | 场景 7 |
| `tests/integration/todo-driven-multistep.integration.test.ts` | Create | 场景 8 |
| `tests/integration/do-continue-after-done.integration.test.ts` | Create | 场景 9 |

---

### Task 1: ActiveForm 加 status/result 字段 + markExecuted 方法（additive 准备）

**Files:**
- Modify: `src/executable/forms/form.ts`
- Test: `src/executable/__tests__/forms.test.ts`

- [ ] **Step 1: 写新增能力的失败测试**

把以下两个测试加到 `src/executable/__tests__/forms.test.ts` 末尾（紧邻最后一个 `});` 前）：

```ts
  it("should default new form status to open", () => {
    const formId = formManager.open("talk", "test description");
    const form = formManager.getForm(formId);
    expect(form?.status).toBe("open");
    expect(form?.result).toBeUndefined();
  });

  it("should transition status from open to executing to executed", () => {
    const formId = formManager.open("program", "shell");
    expect(formManager.getForm(formId)?.status).toBe("open");

    const submitted = formManager.submit(formId);
    expect(submitted?.status).toBe("executing");
    expect(formManager.getForm(formId)?.status).toBe("executing");

    const executed = formManager.markExecuted(formId, "[stdout]\nhi\n[exit 0]");
    expect(executed?.status).toBe("executed");
    expect(executed?.result).toBe("[stdout]\nhi\n[exit 0]");
    expect(formManager.getForm(formId)?.status).toBe("executed");
    expect(formManager.getForm(formId)?.result).toBe("[stdout]\nhi\n[exit 0]");
  });

  it("should reject refine on non-open form", () => {
    const formId = formManager.open("program", "shell");
    formManager.submit(formId);
    const refined = formManager.refine(formId, { code: "ls" });
    expect(refined).toBeNull();
  });

  it("should reject submit on non-open form", () => {
    const formId = formManager.open("program", "shell");
    formManager.submit(formId);
    const second = formManager.submit(formId);
    expect(second).toBeNull();
  });

  it("should default missing status to open when restoring legacy data", () => {
    const restored = FormManager.fromData([
      {
        formId: "f_legacy",
        command: "talk",
        description: "no status field",
        createdAt: 1,
        accumulatedArgs: {},
        commandPaths: ["talk"],
        loadedKnowledgePaths: []
      } as ActiveForm
    ]).getForm("f_legacy");
    expect(restored?.status).toBe("open");
  });
```

并在文件顶部 `import` 行调整：

```ts
import { FormManager, type ActiveForm } from "../forms/form";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/executable/__tests__/forms.test.ts`

Expected: 5 个新测试 FAIL（status 未定义 / markExecuted 不存在）。其余测试 PASS。

- [ ] **Step 3: 给 ActiveForm 加 status/result 字段**

在 `src/executable/forms/form.ts` 的 `ActiveForm` interface 末尾追加：

```ts
  /**
   * Form 生命周期状态。
   * - open：刚 open，未 submit；可以被 refine
   * - executing：submit 已触发但 command 未返回；不可 refine 不可二次 submit
   * - executed：command 已返回，结果在 result 字段；LLM 看完后用 close 释放
   */
  status: "open" | "executing" | "executed";
  /** command 执行返回的结果文本；目前只有 program.shell 真正写入。 */
  result?: string;
```

- [ ] **Step 4: 在 FormManager.open 写入初始 status**

修改 `open` 方法（约 65 行）的 forms.set 调用，在对象字面量里追加：

```ts
this.forms.set(formId, {
  formId,
  command,
  description,
  createdAt: Date.now(),
  accumulatedArgs: {},
  commandPaths: deriveCommandPaths(command, {}).length > 0 ? deriveCommandPaths(command, {}) : [command],
  loadedKnowledgePaths: [],
  status: "open",     // ← 新增
});
```

- [ ] **Step 5: 在 FormManager.refine 加 status guard**

把 `refine` 方法开头的 `if (!form) return null;` 替换成：

```ts
const form = this.forms.get(formId);
if (!form) return null;
if (form.status !== "open") return null;
```

- [ ] **Step 6: 把 FormManager.submit 改成状态机迁移而非删除**

替换整个 `submit` 方法体：

```ts
/** 提交 form，把 status 从 open 切到 executing，返回 form 快照（不删除）。 */
submit(formId: string): ActiveForm | null {
  const form = this.forms.get(formId);
  if (!form) return null;
  if (form.status !== "open") return null;
  const next: ActiveForm = { ...form, status: "executing" };
  this.forms.set(formId, next);
  return next;
}
```

注意：refCount 现在只在 close 时减；submit 不再触碰。

- [ ] **Step 7: 改 FormManager.close 让它接管 refCount 释放**

替换整个 `close` 方法体：

```ts
/** 关闭 form，无论状态都从表中移除，返回被关闭的 form 信息（不存在返回 null）。 */
close(formId: string): ActiveForm | null {
  const form = this.forms.get(formId);
  if (!form) return null;
  this.forms.delete(formId);
  const count = (this.commandRefCount.get(form.command) ?? 1) - 1;
  if (count <= 0) {
    this.commandRefCount.delete(form.command);
  } else {
    this.commandRefCount.set(form.command, count);
  }
  return form;
}
```

- [ ] **Step 8: 新增 markExecuted 方法**

紧接 submit 方法后插入：

```ts
/** 把 form 从 executing 切到 executed 并写入 result（command 完成后由 handler 调用）。 */
markExecuted(formId: string, result?: string): ActiveForm | null {
  const form = this.forms.get(formId);
  if (!form) return null;
  if (form.status !== "executing") return null;
  const next: ActiveForm = { ...form, status: "executed", result };
  this.forms.set(formId, next);
  return next;
}
```

- [ ] **Step 9: fromData 兼容 status 缺省**

在 `fromData` 方法里 `const normalized: ActiveForm = { ... }` 字面量的末尾追加：

```ts
const normalized: ActiveForm = {
  formId: raw.formId,
  command: raw.command,
  description: raw.description,
  createdAt: raw.createdAt,
  accumulatedArgs: accumulated,
  commandPaths,
  loadedKnowledgePaths,
  status: raw.status ?? "open",   // ← 新增
  result: raw.result,              // ← 新增
};
```

- [ ] **Step 10: 修复老 forms.test.ts 中的 close-vs-submit 测试**

把 `should close a form same as submit` 测试改成：

```ts
  it("should close a form regardless of status", () => {
    const formId = formManager.open("talk", "test description");
    const closed = formManager.close(formId);

    expect(closed).not.toBeNull();
    expect(closed?.formId).toBe(formId);

    const afterClose = formManager.getForm(formId);
    expect(afterClose).toBeNull();
  });
```

把 `should submit a form and remove it from active forms` 测试改成：

```ts
  it("should keep submitted form in active set as executing", () => {
    const formId = formManager.open("talk", "test description");
    const submitted = formManager.submit(formId);

    expect(submitted).not.toBeNull();
    expect(submitted?.formId).toBe(formId);
    expect(submitted?.status).toBe("executing");

    const stillThere = formManager.getForm(formId);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe("executing");
  });
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `bun test src/executable/__tests__/forms.test.ts`

Expected: 全部 PASS（包括 5 个新测试 + 2 个改过的老测试 + 其它老测试）。

- [ ] **Step 12: Run full unit suite to assess collateral damage**

Run: `bun test`

Expected: 大概率几个 thinkloop / commands-execution 测试 FAIL（仍依赖老的"submit 后 form 消失"行为）。记录失败的测试名，留到 Task 2 一起修。

- [ ] **Step 13: Commit**

```bash
git add src/executable/forms/form.ts src/executable/__tests__/forms.test.ts
git commit -m "feat: extend form with status and result fields"
```

---

### Task 2: handleSubmitTool 新流程 + executeCommand 签名 + 修复受影响测试

**Files:**
- Modify: `src/executable/tools/submit.ts`
- Modify: `src/executable/tools/refine.ts`
- Modify: `src/executable/commands/index.ts`
- Modify: `src/executable/commands/{plan,todo,do,end,talk,program}.ts`
- Modify: `src/thinkable/__tests__/thinkloop.test.ts`

- [ ] **Step 1: 修 thinkloop.test.ts 第一个失败断言**

打开 `src/thinkable/__tests__/thinkloop.test.ts` 找到 line 267（`expect(thread.activeForms).toEqual([]);` 这行所在的测试）。把那段断言替换成：

```ts
    await think(thread, llmClient);
    expect(thread.activeForms).toHaveLength(1);
    expect(thread.activeForms?.[0]?.status).toBe("executed");
    const lastEvent = thread.events.at(-1);
    expect(lastEvent?.category).toBe("context_change");
    expect(lastEvent?.kind).toBe("inject");
    expect(lastEvent && "text" in lastEvent ? lastEvent.text : "").toContain("[form executed]");
```

- [ ] **Step 2: executeCommand 改签名 `Promise<string | undefined>`**

替换 `src/executable/commands/index.ts` 末尾的 `executeCommand` 函数：

```ts
/**
 * 执行命令并返回 result 字符串（可选）。
 *
 * - program 返回 shell 输出
 * - 其它命令返回 undefined（副作用通过 ctx.thread 完成）
 */
export async function executeCommand(command: string, ctx: CommandExecutionContext): Promise<string | undefined> {
  switch (command) {
    case "program":
      return executeProgramCommand(ctx);
    case "talk":
      return executeTalkCommand(ctx);
    case "do":
      return executeDoCommand(ctx);
    case "plan":
      return executePlanCommand(ctx);
    case "todo":
      return executeTodoCommand(ctx);
    case "end":
      return executeEndCommand(ctx);
    default:
      return undefined;
  }
}
```

- [ ] **Step 3: 五个非 program command 改成显式 return undefined**

修改以下文件，把每个 execute*Command 函数的签名 `Promise<void>` 改成 `Promise<string | undefined>`，并在末尾确保 `return undefined`（隐式即可，TS 会推断；但显式标 return type 更清晰）。仅改类型注解，不改逻辑：

- `src/executable/commands/plan.ts`：`export async function executePlanCommand(ctx: CommandExecutionContext): Promise<string | undefined> { ... }` （末尾 `ctx.thread.plan = plan` 后已 return undefined）
- `src/executable/commands/todo.ts`：同上签名
- `src/executable/commands/do.ts`：同上签名
- `src/executable/commands/end.ts`：同上签名
- `src/executable/commands/talk.ts`：同上签名
- `src/executable/commands/program.ts`：把 `executeProgramCommand` 签名改成 `Promise<string | undefined>`（实现还是空壳，下个 task 补）

- [ ] **Step 4: 重写 handleSubmitTool**

整个替换 `src/executable/tools/submit.ts` 中 `handleSubmitTool` 函数：

```ts
/** 执行 submit tool：把 form 切到 executing，跑 command，再切到 executed 并写入 result。 */
export async function handleSubmitTool(
  thread: ThreadContext,
  args: Record<string, unknown>
): Promise<void> {
  const formId = args.form_id as string;
  const formManager = FormManager.fromData(thread.activeForms ?? []);
  const existing = formManager.getForm(formId);

  if (!existing) {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[错误] submit 失败：Form ${formId} 不存在。`
    });
    return;
  }
  if (existing.status !== "open") {
    thread.events.push({
      category: "context_change",
      kind: "inject",
      text: `[错误] submit 失败：Form ${formId} 不在 open 状态（当前 ${existing.status}）。`
    });
    return;
  }

  const submitted = formManager.submit(formId)!;
  thread.activeForms = formManager.toData();
  thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[form executing] formId=${formId} command=${submitted.command}`
  });

  const finalArgs = { ...submitted.accumulatedArgs, ...args };
  let result: string | undefined;
  try {
    result = await executeCommand(submitted.command, { thread, form: submitted, args: finalArgs });
  } catch (error) {
    result = `[command-error] ${(error as Error).message}`;
  }

  formManager.markExecuted(formId, result);
  thread.activeForms = formManager.toData();
  thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[form executed] formId=${formId}`
  });
}
```

- [ ] **Step 5: 改 refine.ts 区分两种错误**

在 `src/executable/tools/refine.ts` 中，`handleRefineTool` 函数中替换 `if (!updatedForm)` 那段：

```ts
const formManager = FormManager.fromData(thread.activeForms ?? []);
const existing = formManager.getForm(formId);

if (!existing) {
  thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[错误] refine 失败：Form ${formId} 不存在。`
  });
  return;
}
if (existing.status !== "open") {
  thread.events.push({
    category: "context_change",
    kind: "inject",
    text: `[错误] refine 失败：Form ${formId} 不在 open 状态（当前 ${existing.status}）。`
  });
  return;
}

const updatedForm = formManager.refine(formId, incoming)!;
```

并删掉 `if (!updatedForm)` 整段（已被上面的预检查替代）。

- [ ] **Step 6: Run all tests**

Run: `bun test`

Expected: 全部 PASS。如果有别的测试 FAIL（比如老 commands-execution 测试），分两类处理：
- 测试断言"submit 后 form 消失" → 改成断言 status="executed"
- 测试断言"submit inject 文案是 [submit] Form X 已提交" → 改成断言最后一个 inject 是 `[form executed] formId=X`

- [ ] **Step 7: Run TypeScript check**

Run: `bunx tsc --noEmit`

Expected: exit code 0。

- [ ] **Step 8: Commit**

```bash
git add src/executable src/thinkable/__tests__/thinkloop.test.ts
git commit -m "feat: split submit into executing and executed events"
```

---

### Task 3: program.shell 实现 + 4 个错误路径单元测试

**Files:**
- Modify: `src/executable/commands/program.ts`
- Test: `src/executable/__tests__/program.test.ts`

- [ ] **Step 1: 新建失败测试**

创建 `src/executable/__tests__/program.test.ts`：

```ts
import { describe, expect, it } from "bun:test";
import { executeProgramCommand } from "../commands/program";
import type { ThreadContext } from "../../thinkable/context";

function makeCtx(args: Record<string, unknown>) {
  const thread: ThreadContext = { id: "t", status: "running", events: [] };
  return { thread, args };
}

describe("program.shell", () => {
  it("returns formatted result for a successful command", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "shell", code: "echo hello" }));
    expect(result).toContain("$ echo hello");
    expect(result).toContain("[stdout]");
    expect(result).toContain("hello");
    expect(result).toContain("[exit 0]");
  });

  it("captures non-zero exit code", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "shell", code: "exit 7" }));
    expect(result).toContain("[exit 7]");
  });

  it("captures stderr", async () => {
    const result = await executeProgramCommand(
      makeCtx({ language: "shell", code: "echo bad >&2; exit 1" })
    );
    expect(result).toContain("[stderr]");
    expect(result).toContain("bad");
    expect(result).toContain("[exit 1]");
  });

  it("truncates oversize stdout", async () => {
    // 生成约 8KB 的输出
    const result = await executeProgramCommand(
      makeCtx({ language: "shell", code: "head -c 8192 /dev/zero | tr '\\0' 'a'" })
    );
    expect(result).toContain("...[truncated, original");
  });

  it("rejects non-shell language with explicit message", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "ts", code: "console.log(1)" }));
    expect(result).toContain("本阶段仅支持 language=\"shell\"");
  });

  it("rejects missing code", async () => {
    const result = await executeProgramCommand(makeCtx({ language: "shell" }));
    expect(result).toContain("缺少 code 参数");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/__tests__/program.test.ts`

Expected: 全部 FAIL（program 仍是空壳）。

- [ ] **Step 3: 实现 executeProgramCommand**

整个替换 `src/executable/commands/program.ts` 末尾的 `executeProgramCommand`，并在文件顶部把 `// 暂不实现具体执行逻辑` 那行删掉。同时在 import 里加：

```ts
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

const MAX_OUTPUT_BYTES = 4096;

function truncate(text: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= MAX_OUTPUT_BYTES) return text;
  const head = new TextDecoder().decode(bytes.slice(0, MAX_OUTPUT_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

function formatShellResult(code: string, stdout: string, stderr: string, exitCode: number): string {
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  const lines = [`$ ${firstLine}`];
  if (stdout) lines.push("[stdout]", truncate(stdout));
  if (stderr) lines.push("[stderr]", truncate(stderr));
  // 退出码 124 是 timeout 约定（与 GNU coreutils timeout 一致）
  lines.push(exitCode === 124 ? "[timeout 30s]" : `[exit ${exitCode}]`);
  return lines.join("\n");
}

async function runShell(code: string): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["sh", "-c", code], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    });
  } catch (error) {
    return `[program.shell] 启动失败: ${(error as Error).message}`;
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return formatShellResult(code, stdout, stderr, exitCode);
}

/** 执行 program command；当前阶段仅支持 language="shell"。 */
export async function executeProgramCommand(ctx: CommandExecutionContext): Promise<string | undefined> {
  const language = (ctx.args.language ?? ctx.args.lang) as string | undefined;
  const code = ctx.args.code as string | undefined;

  if (language !== "shell") {
    return `[program] 本阶段仅支持 language="shell"，收到 language="${language ?? "<undefined>"}"`;
  }
  if (typeof code !== "string" || code.trim() === "") {
    return `[program.shell] 缺少 code 参数`;
  }

  return runShell(code);
}
```

- [ ] **Step 4: Run program tests to verify they pass**

Run: `bun test src/executable/__tests__/program.test.ts`

Expected: 6 个测试全部 PASS。

- [ ] **Step 5: Run full suite**

Run: `bun test && bunx tsc --noEmit`

Expected: PASS / exit 0。

- [ ] **Step 6: Commit**

```bash
git add src/executable/commands/program.ts src/executable/__tests__/program.test.ts
git commit -m "feat: implement program.shell with timeout and truncation"
```

---

### Task 4: context.renderActiveForms 加 status / result 渲染

**Files:**
- Modify: `src/thinkable/context.ts`
- Test: `src/thinkable/__tests__/context.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/thinkable/__tests__/context.test.ts` 末尾加（在最后 `});` 前）：

```ts
  it("renders form status attribute and shows result only when executed", async () => {
    const thread: ThreadContext = {
      id: "t_status",
      status: "running",
      events: [],
      activeForms: [
        {
          formId: "f_open",
          command: "program",
          description: "shell",
          createdAt: 1,
          accumulatedArgs: { language: "shell", code: "ls" },
          commandPaths: ["program", "program.shell"],
          loadedKnowledgePaths: [],
          status: "open"
        },
        {
          formId: "f_executing",
          command: "program",
          description: "shell",
          createdAt: 2,
          accumulatedArgs: {},
          commandPaths: ["program"],
          loadedKnowledgePaths: [],
          status: "executing"
        },
        {
          formId: "f_executed",
          command: "program",
          description: "shell",
          createdAt: 3,
          accumulatedArgs: {},
          commandPaths: ["program"],
          loadedKnowledgePaths: [],
          status: "executed",
          result: "$ ls\n[stdout]\nfoo\n[exit 0]"
        }
      ]
    };

    const messages = await buildContext(thread);
    const xml = messages[0]?.content ?? "";

    expect(xml).toContain('<form id="f_open" status="open">');
    expect(xml).toContain('<form id="f_executing" status="executing">');
    expect(xml).toContain('<form id="f_executed" status="executed">');
    // 只有 executed 才渲染 result 段
    expect(xml).toMatch(/<form id="f_executed"[\s\S]*<result>\$ ls\n\[stdout\]\nfoo\n\[exit 0\]<\/result>[\s\S]*<\/form>/);
    expect(xml).not.toMatch(/<form id="f_open"[\s\S]*<result>/);
    expect(xml).not.toMatch(/<form id="f_executing"[\s\S]*<result>/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/thinkable/__tests__/context.test.ts`

Expected: 新测试 FAIL（status 属性和 result 段未渲染）。

- [ ] **Step 3: 修改 renderActiveForms**

在 `src/thinkable/context.ts` 中，整个替换 `renderActiveForms` 函数体内 form 渲染部分（找到 `return [` `\`<form id="${escapeXml(form.formId)}">\``...这一段）：

```ts
function renderActiveForms(activeForms: ActiveForm[] | undefined): string {
  if (!activeForms || activeForms.length === 0) return "";

  const items = activeForms
    .map((form) => {
      const status = form.status ?? "open";
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
      const resultXml = status === "executed" && form.result
        ? `<result>${escapeXml(form.result)}</result>`
        : "";

      return [
        `<form id="${escapeXml(form.formId)}" status="${escapeXml(status)}">`,
        `<command>${escapeXml(form.command)}</command>`,
        `<description>${escapeXml(form.description)}</description>`,
        `<accumulated_args>${escapeXml(JSON.stringify(form.accumulatedArgs))}</accumulated_args>`,
        commandPaths,
        loadedKnowledge,
        resultXml,
        "</form>"
      ].join("");
    })
    .join("");

  return `<active_forms>${items}</active_forms>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/thinkable/__tests__/context.test.ts`

Expected: PASS。

- [ ] **Step 5: Run full suite**

Run: `bun test && bunx tsc --noEmit`

Expected: PASS / exit 0。

- [ ] **Step 6: Commit**

```bash
git add src/thinkable/context.ts src/thinkable/__tests__/context.test.ts
git commit -m "feat: render form status and result in context"
```

---

### Task 5: do.continue + wait 对称补全

**Files:**
- Modify: `src/executable/commands/do.ts`
- Test: `src/executable/__tests__/do-thread-tree.test.ts`

- [ ] **Step 1: 写失败测试**

打开 `src/executable/__tests__/do-thread-tree.test.ts`，在文件末尾最后一个 `});` 前追加：

```ts
  it("do.continue with wait=true puts parent into await_children", async () => {
    const child: ThreadContext = {
      id: "t_child",
      status: "done",
      events: [],
      parentThreadId: "t_parent"
    };
    const parent: ThreadContext = {
      id: "t_parent",
      status: "running",
      events: [],
      childThreadIds: ["t_child"],
      childThreads: { t_child: child }
    };

    await executeCommand("do", {
      thread: parent,
      args: {
        context: "continue",
        threadId: "t_child",
        msg: "再做 task B",
        wait: true
      }
    });

    expect(parent.status).toBe("waiting");
    expect(parent.waitingType).toBe("await_children");
    expect(parent.awaitingChildren).toEqual(["t_child"]);
    // 子线程也应该被翻回 running
    expect(child.status).toBe("running");
    expect(child.inbox?.length).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/executable/__tests__/do-thread-tree.test.ts`

Expected: 新测试 FAIL（parent 仍是 running）。

- [ ] **Step 3: 在 do.ts 的 continue 分支末尾补 wait 处理**

在 `src/executable/commands/do.ts` 找到 `executeDoCommand` 函数末尾（`if (targetThread.status === "done" || targetThread.status === "failed") { targetThread.status = "running"; }` 之后），追加：

```ts
  // 与 fork 分支对称：wait=true 时父线程进入 await_children
  if (ctx.args.wait === true) {
    ctx.thread.status = "waiting";
    ctx.thread.waitingType = "await_children";
    ctx.thread.awaitingChildren = [targetThreadId];
  }
}
```

注意最后那个 `}` 是 executeDoCommand 函数的闭合，不要重复加。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/executable/__tests__/do-thread-tree.test.ts`

Expected: PASS。

- [ ] **Step 5: Run full suite**

Run: `bun test && bunx tsc --noEmit`

Expected: PASS / exit 0。

- [ ] **Step 6: Commit**

```bash
git add src/executable/commands/do.ts src/executable/__tests__/do-thread-tree.test.ts
git commit -m "feat: support wait in do.continue branch"
```

---

### Task 6: 文档同步（program / do / executable index）

**Files:**
- Modify: `meta/object/executable/actions/commands/program.doc.js`
- Modify: `meta/object/executable/actions/commands/do.doc.js`
- Modify: `meta/object/executable/index.doc.js`

- [ ] **Step 1: 在 program.doc.js 加"当前实现阶段"段**

打开 `meta/object/executable/actions/commands/program.doc.js`，在 index 模板字符串末尾（`\`,` 前）追加：

```
## 当前实现阶段

当前实现仅支持 language="shell"：
- 通过 sh -c 执行 code 字符串
- cwd 固定为 process.cwd()（项目根）；env 继承 parent process
- 30 秒超时（exit code 124），stdout/stderr 各 4KB 截断
- 输出归一化为单一字符串赋给 form.result，供 LLM 在下一轮 active_forms 中读取

当前不支持：
- language="ts" / "js"（脚本沙箱）
- function 模式（调用 server export 方法）
- 命令白名单 / 沙箱隔离
```

- [ ] **Step 2: 在 do.doc.js 的 KNOWLEDGE 末尾补 continue+wait 示例**

打开 `meta/object/executable/actions/commands/do.doc.js`，在 `export const KNOWLEDGE = \`...\``  末尾的 \``  前追加：

```

continue + wait 示例（supervisor 给已完成的子线程追加任务并等结果）：
open(type="command", command="do", description="给 task A 已完成的子线程追加 task B")
refine(form_id, { context: "continue", threadId: "t_child", msg: "再数 src/thinkable 下的 ts 文件", wait: true })
submit(form_id)
```

- [ ] **Step 3: 在 executable/index.doc.js 更新生命周期描述**

打开 `meta/object/executable/index.doc.js`，找到"渐进式披露"那段。把以下文本：

```
LLM 想清楚后 submit 执行
   ↓
form 关闭，本次引入的 knowledge 自动卸载
```

替换为：

```
LLM 想清楚后 submit 执行
   ↓
form 切到 executing 状态（仍在 active_forms 中）
   ↓
command 完成后 form 切到 executed，result 进入 context
   ↓
LLM 看完 result 后用 close 释放 form 与 knowledge
```

- [ ] **Step 4: 验证 doc 解析正常**

Run: `bunx tsc --noEmit`

Expected: exit 0（doc.js 被 tsc include 校验语法）。

- [ ] **Step 5: Commit**

```bash
git add meta/object/executable/index.doc.js meta/object/executable/actions/commands/program.doc.js meta/object/executable/actions/commands/do.doc.js
git commit -m "docs: sync executable docs with new lifecycle and program.shell"
```

---

### Task 7: 集成测试基础设施（目录 / fixture / tsconfig）

**Files:**
- Modify: `tsconfig.json`
- Create: `tests/integration/_fixture.ts`

- [ ] **Step 1: tsconfig.json 加 tests 目录**

打开 `tsconfig.json`，把：

```json
"include": ["src/**/*.ts", "meta/**/*.js"]
```

改成：

```json
"include": ["src/**/*.ts", "meta/**/*.js", "tests/**/*.ts"]
```

- [ ] **Step 2: 创建通用 fixture**

新建 `tests/integration/_fixture.ts`：

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFlowObject } from "../../src/persistable";
import { createLlmClient } from "../../src/thinkable/llm/client";
import type { LlmClient } from "../../src/thinkable/llm/types";
import type { ThreadContext } from "../../src/thinkable/context";

/** 当所有 OOC_* env 都设置时返回 true，否则集成测试自动 skip。 */
export const hasLlmEnv = Boolean(
  process.env.OOC_API_KEY && process.env.OOC_BASE_URL && process.env.OOC_MODEL
);

/** 懒构造，避免在 skip 路径上读到坏 env 抛错。 */
let cachedClient: LlmClient | undefined;
export function llm(): LlmClient {
  if (!cachedClient) cachedClient = createLlmClient();
  return cachedClient;
}

/** 为单个集成测试准备 mkdtemp + cleanup。 */
export async function setupTempFlow(): Promise<{ tempRoot: string; cleanup: () => Promise<void> }> {
  const tempRoot = await mkdtemp(join(tmpdir(), "ooc-it-"));
  const cleanup = async () => { await rm(tempRoot, { recursive: true, force: true }); };
  return { tempRoot, cleanup };
}

/** 在临时 flow object 下创建一个携带初始 prompt 的 root thread。 */
export async function makeRootThread(tempRoot: string, prompt: string): Promise<ThreadContext> {
  const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
  return {
    id: "root",
    status: "running",
    events: [{ category: "context_change", kind: "inject", text: prompt }],
    activeForms: [],
    persistence: { ...flow, threadId: "root" },
  };
}

/** 统计 thread.events 中 inject 文案以指定前缀开头的数量。 */
export function countEventsWithPrefix(thread: ThreadContext, prefix: string): number {
  return thread.events.filter(
    (e) => e.category === "context_change" && e.kind === "inject" && e.text.startsWith(prefix)
  ).length;
}
```

- [ ] **Step 3: 验证 fixture 类型检查通过**

Run: `bunx tsc --noEmit`

Expected: exit 0。

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json tests/integration/_fixture.ts
git commit -m "test: add integration test fixture and tsconfig include"
```

---

### Task 8: 集成测试场景 1 — shell-exec-basic

**Files:**
- Create: `tests/integration/shell-exec-basic.integration.test.ts`

- [ ] **Step 1: 创建集成测试**

新建 `tests/integration/shell-exec-basic.integration.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: shell-exec-basic", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent counts ts files via shell and ends", async () => {
    const root = await makeRootThread(
      tempRoot,
      "请用 shell 命令查一下 src/persistable/ 下有几个 .ts 文件（不含 __tests__/ 子目录），告诉我数字然后 end。"
    );

    await runScheduler(root, llm(), { maxTicks: 12 });

    expect(root.status).toBe("done");
    expect(root.endSummary?.length ?? 0).toBeGreaterThan(0);
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
```

- [ ] **Step 2: 验证集成测试在有 env 时 PASS / 无 env 时 skip**

Run（需要本地 `.env` 已配置 OOC_API_KEY）: `bun test tests/integration/shell-exec-basic.integration.test.ts`

Expected: 1 PASS（约 10-30 秒）或者 1 skip（如果 env 未导入 process.env）。

如果跑 skip：先 `source .env && export OOC_API_KEY OOC_BASE_URL OOC_MODEL OOC_PROVIDER` 再跑。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/shell-exec-basic.integration.test.ts
git commit -m "test(integration): shell-exec-basic"
```

---

### Task 9: 集成测试场景 2 — plan-then-execute

**Files:**
- Create: `tests/integration/plan-then-execute.integration.test.ts`

- [ ] **Step 1: 创建集成测试**

新建 `tests/integration/plan-then-execute.integration.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: plan-then-execute", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent makes a plan then executes via shell", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请先做一份执行计划（用 plan command）：'数 src/ 下所有 .ts 文件总数'。",
        "然后按计划用 shell 执行，把数字告诉我，最后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 14 });

    expect(root.status).toBe("done");
    expect(root.plan?.length ?? 0).toBeGreaterThan(0);
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(2);
  }, 180_000);
});
```

- [ ] **Step 2: 跑测试**

Run: `bun test tests/integration/plan-then-execute.integration.test.ts`

Expected: PASS（约 20-40 秒）。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/plan-then-execute.integration.test.ts
git commit -m "test(integration): plan-then-execute"
```

---

### Task 10: 集成测试场景 3 — multi-shell-chain

**Files:**
- Create: `tests/integration/multi-shell-chain.integration.test.ts`

- [ ] **Step 1: 创建集成测试**

新建 `tests/integration/multi-shell-chain.integration.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: multi-shell-chain", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent finds the largest ts file then prints its first 20 lines", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "用 shell 找 src/ 下行数最多的 .ts 文件（不含 __tests__/）。",
        "找到后再用一次 shell 打印它的前 20 行。",
        "最后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 14 });

    expect(root.status).toBe("done");
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(2);
  }, 180_000);
});
```

- [ ] **Step 2: 跑测试**

Run: `bun test tests/integration/multi-shell-chain.integration.test.ts`

Expected: PASS（约 20-40 秒）。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/multi-shell-chain.integration.test.ts
git commit -m "test(integration): multi-shell-chain"
```

---

### Task 11: 集成测试场景 4 — abandon-via-close

**Files:**
- Create: `tests/integration/abandon-via-close.integration.test.ts`

- [ ] **Step 1: 创建集成测试**

新建 `tests/integration/abandon-via-close.integration.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: abandon-via-close", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent opens program form then closes without submit", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请演示 close tool 的用法：先 open 一个 program form（language=shell, code=ls），",
        "然后立即 close 它（不要 submit！只 close），reason='演示放弃这次行动'。",
        "完成后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 8 });

    expect(root.status).toBe("done");
    expect(countEventsWithPrefix(root, "[close]")).toBeGreaterThanOrEqual(1);
    // 因为没 submit，所以应该没有 form executed 事件
    expect(countEventsWithPrefix(root, "[form executed]")).toBe(0);
  }, 120_000);
});
```

- [ ] **Step 2: 跑测试**

Run: `bun test tests/integration/abandon-via-close.integration.test.ts`

Expected: PASS（约 10-25 秒）。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/abandon-via-close.integration.test.ts
git commit -m "test(integration): abandon-via-close"
```

---

### Task 12: 集成测试场景 5 — do-fork-and-collect

**Files:**
- Create: `tests/integration/do-fork-and-collect.integration.test.ts`

- [ ] **Step 1: 创建集成测试**

新建 `tests/integration/do-fork-and-collect.integration.test.ts`：

```ts
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import { threadFile } from "../../src/persistable";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: do-fork-and-collect", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("supervisor forks a sub-thread, waits for it, then ends", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请派一个子线程（do command, context=fork, wait=true）执行任务：",
        "用 shell 数 src/ 下所有 .ts 文件总数。",
        "等子线程完成后，告诉我数字然后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 16 });

    expect(root.status).toBe("done");
    expect(root.childThreadIds?.length ?? 0).toBeGreaterThanOrEqual(1);

    const childId = root.childThreadIds![0]!;
    const child = root.childThreads![childId];
    expect(child.status).toBe("done");
    expect(countEventsWithPrefix(child, "[form executed]")).toBeGreaterThanOrEqual(1);

    // 子线程也落盘了
    if (child.persistence) {
      const saved = JSON.parse(await readFile(threadFile(child.persistence), "utf8"));
      expect(saved.status).toBe("done");
    }
  }, 180_000);
});
```

注意：当前 do.fork 没有自动给子线程设 `persistence` ref。如果 child.persistence 是 undefined，最后一段断言会跳过；这个测试主要验证父子调度而非子线程持久化（子线程持久化是另一个 future task）。

- [ ] **Step 2: 跑测试**

Run: `bun test tests/integration/do-fork-and-collect.integration.test.ts`

Expected: PASS（约 30-60 秒）。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/do-fork-and-collect.integration.test.ts
git commit -m "test(integration): do-fork-and-collect"
```

---

### Task 13: 集成测试场景 6 — wait-state-transition

**Files:**
- Create: `tests/integration/wait-state-transition.integration.test.ts`

- [ ] **Step 1: 创建集成测试**

新建 `tests/integration/wait-state-transition.integration.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: wait-state-transition", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent enters waiting state via wait tool", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请直接调用 wait tool，reason='等待用户输入'。",
        "不要做其它事，不要 open 任何 form，不要 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 5 });

    expect(root.status).toBe("waiting");
    expect(root.waitingType).toBe("explicit_wait");
  }, 60_000);
});
```

- [ ] **Step 2: 跑测试**

Run: `bun test tests/integration/wait-state-transition.integration.test.ts`

Expected: PASS（约 5-15 秒）。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/wait-state-transition.integration.test.ts
git commit -m "test(integration): wait-state-transition"
```

---

### Task 14: 集成测试场景 7 — executed-form-cleanup

**Files:**
- Create: `tests/integration/executed-form-cleanup.integration.test.ts`

- [ ] **Step 1: 创建集成测试**

新建 `tests/integration/executed-form-cleanup.integration.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: executed-form-cleanup", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent runs ls, reads result, closes form, then ends", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请用 shell 跑 'ls src/'，看到结果后立刻 close 那个已 executed 的 form 释放 context。",
        "然后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 10 });

    expect(root.status).toBe("done");
    expect(countEventsWithPrefix(root, "[form executed]")).toBeGreaterThanOrEqual(1);
    expect(countEventsWithPrefix(root, "[close]")).toBeGreaterThanOrEqual(1);

    // 最终 activeForms 应不残留任何 program form
    const programForms = (root.activeForms ?? []).filter((f) => f.command === "program");
    expect(programForms.length).toBe(0);
  }, 120_000);
});
```

- [ ] **Step 2: 跑测试**

Run: `bun test tests/integration/executed-form-cleanup.integration.test.ts`

Expected: PASS（约 15-30 秒）。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/executed-form-cleanup.integration.test.ts
git commit -m "test(integration): executed-form-cleanup"
```

---

### Task 15: 集成测试场景 8 — todo-driven-multistep

**Files:**
- Create: `tests/integration/todo-driven-multistep.integration.test.ts`

- [ ] **Step 1: 创建集成测试**

新建 `tests/integration/todo-driven-multistep.integration.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: todo-driven-multistep", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("agent uses todo to track two tasks then completes them via shell", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "你接下来要完成两件事：",
        "(1) 数 src/persistable/ 下 .ts 文件数量；",
        "(2) 数 src/thinkable/ 下 .ts 文件数量。",
        "请先用 todo command 把这两件事登记成 todo（open + refine + submit 各一次），",
        "然后逐个用 shell 执行，每完成一件后用 close 把对应 todo form 关闭。",
        "全部完成后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 18 });

    expect(root.status).toBe("done");

    // 至少 2 个 todo 被 submit + executed
    const todoExecuted = (root.events ?? []).filter(
      (e) =>
        e.category === "context_change" &&
        e.kind === "inject" &&
        e.text.startsWith("[form executed]")
    );
    expect(todoExecuted.length).toBeGreaterThanOrEqual(4); // 2 todo + 2 program

    expect(countEventsWithPrefix(root, "[form executing]")).toBeGreaterThanOrEqual(4);
  }, 240_000);
});
```

- [ ] **Step 2: 跑测试**

Run: `bun test tests/integration/todo-driven-multistep.integration.test.ts`

Expected: PASS（约 40-90 秒，多 tick 流程）。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/todo-driven-multistep.integration.test.ts
git commit -m "test(integration): todo-driven-multistep"
```

---

### Task 16: 集成测试场景 9 — do-continue-after-done

**Files:**
- Create: `tests/integration/do-continue-after-done.integration.test.ts`

- [ ] **Step 1: 创建集成测试**

新建 `tests/integration/do-continue-after-done.integration.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runScheduler } from "../../src/thinkable/scheduler";
import {
  countEventsWithPrefix,
  hasLlmEnv,
  llm,
  makeRootThread,
  setupTempFlow,
} from "./_fixture";

describe.skipIf(!hasLlmEnv)("integration: do-continue-after-done", () => {
  let tempRoot: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ tempRoot, cleanup } = await setupTempFlow());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("supervisor appends task to sub-thread via do.continue + wait", async () => {
    const root = await makeRootThread(
      tempRoot,
      [
        "请派一个子线程执行 task A：用 shell 数 src/persistable/ 下的 .ts 文件数。",
        "（用 do command, context=fork, wait=true）",
        "等子线程完成 task A 后，再用 do command, context=continue, threadId=<刚才那个子线程的 id>, wait=true",
        "追加 task B：用 shell 数 src/thinkable/ 下的 .ts 文件数。",
        "等 task B 也完成后，告诉我两个数字然后 end。",
      ].join("\n")
    );

    await runScheduler(root, llm(), { maxTicks: 20 });

    expect(root.status).toBe("done");
    expect(root.childThreadIds?.length).toBe(1);

    const childId = root.childThreadIds![0]!;
    const child = root.childThreads![childId];
    expect(child.status).toBe("done");

    // 子线程应跑了至少 2 个 program executed
    expect(countEventsWithPrefix(child, "[form executed]")).toBeGreaterThanOrEqual(2);
  }, 240_000);
});
```

- [ ] **Step 2: 跑测试**

Run: `bun test tests/integration/do-continue-after-done.integration.test.ts`

Expected: PASS（约 40-90 秒）。

- [ ] **Step 3: Commit**

```bash
git add tests/integration/do-continue-after-done.integration.test.ts
git commit -m "test(integration): do-continue-after-done"
```

---

### Task 17: 全量收敛验证

**Files:**
- Verify: 所有改动

- [ ] **Step 1: 运行全套单元测试**

Run: `bun test src`

Expected: 全部 PASS，0 fail。

- [ ] **Step 2: 运行类型检查**

Run: `bunx tsc --noEmit`

Expected: exit 0。

- [ ] **Step 3: 运行全套集成测试（需要 .env）**

Run（确保 OOC_API_KEY 等已 export 到 process.env）: `bun test tests/integration`

Expected: 9 个 PASS（约 3-8 分钟）。

如果某场景偶发 fail（比如 LLM 当 tick 偷懒），允许重跑 1 次。重跑仍 fail 则记入 issue 列表，不算交付通过。

- [ ] **Step 4: doc/source 同步扫描**

Run: `grep -R "sources:" -n meta/object | sort | head -30`

Expected: persistable / observable / thinkable / executable 的 doc.js 都有 sources 绑定。

Run: `grep -R "form 关闭" meta/object/executable`

Expected: 只在更新过的 index.doc.js 中以新表述出现，不出现旧版"submit → form 关闭"。

- [ ] **Step 5: 查看 commit history 确认每个 task 都有清晰提交**

Run: `git log --oneline main..HEAD`

Expected: 16 个 commit（Task 1–16），每个 commit 信息清晰对应一个 task。

- [ ] **Step 6: 不提交（如果第 4 步发现 doc 漏掉，单独修后 commit）**

无需新提交时跳过。

---

## Self-Review

- **Spec 覆盖**：spec 的 8 个章节全部映射到 task。
  - I（form 生命周期）→ Task 1, 2
  - II（program.shell）→ Task 3
  - III（do.continue + wait）→ Task 5
  - IV（文件清单）→ 跨 Task 1-6 全覆盖
  - V（集成测试 9 场景）→ Task 7-16
  - VI（自检）→ 设计文档已提交，无需重做
  - VII（非目标）→ Task 6 doc 中显式声明
  - VIII（实施顺序）→ 本 plan 即遵循
- **Placeholder 扫描**：无 TBD / TODO / "类似 Task N" 等占位文本。
- **类型一致性**：
  - `executeCommand` 签名 `Promise<string | undefined>` 在 Task 2 定义，Task 3 的 `executeProgramCommand` 同步使用
  - `markExecuted(formId, result?)` 在 Task 1 定义，Task 2 的 handleSubmitTool 调用
  - `ActiveForm.status` "open"/"executing"/"executed" 三态在所有 task 中保持一致
  - `countEventsWithPrefix` 在 Task 7 定义，Task 8-16 全部使用同一签名
- **fixture 复用**：9 个集成测试全部复用 `_fixture.ts`，没有重复定义 setup/cleanup 逻辑
- **commit 粒度**：每个 task 一个 commit，16 个 task = 16 个 commit + 1 个验证 task = 17 个步骤

---

## 注意事项

- **集成测试 flake 容忍**：真 LLM 输出有随机性。如果某 task 的 LLM 不按预期 tool 序列做事（比如该 close 的没 close），先重跑 1 次。仍 fail 时检查 prompt 是否够明确，调整 prompt 而非降低断言强度。
- **maxTicks 调优**：每个集成测试都有 maxTicks 上限。如果跑超时大概率说明 prompt 让 LLM 卡在某处，增加 maxTicks 不是治本之计——优先改 prompt。
- **API 成本**：9 个集成测试一次跑全约 50-100 次 LLM 调用，按 Claude 代理服务定价单次跑大约 $0.1-0.3。
- **本地跑集成测试**：`source .env && export $(grep -v '^#' .env | cut -d= -f1) && bun test tests/integration`。
