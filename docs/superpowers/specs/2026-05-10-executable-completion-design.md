# Executable Completion & Integration Test Suite Design

**Date:** 2026-05-10
**Scope:** 把 OOC executable 层补齐到"可用"状态（最小 ReAct 闭环），并设计真 LLM 端到端集成测试套件。

---

## 背景

当前 OOC 的执行能力骨架完整但缺关键肌肉：

- 5 个 tool（open/refine/submit/close/wait）handler 齐全
- 6 个 command 中 plan/todo/do/end/talk 已实现，**program 是空壳**
- 没有任何"行动结果回喂下一轮 LLM"的统一机制
- 80 个单元测试以 stub LLM 覆盖内部逻辑，但没有真 LLM 端到端验证

本设计补齐 3 件事：

1. **重构 form 生命周期**，让 LLM 在 active_forms 中能直接看到"行动是否在跑/已跑出什么"
2. **实现 program.shell**，让 LLM 真的能对外部世界做事
3. **补 do.continue + wait 的对称实现**，让 supervisor 模式能给子线程追加任务并等结果

并新建真 LLM 驱动的集成测试套件覆盖 9 个端到端场景。

---

## I. Form 生命周期重构

### ActiveForm 类型扩展

```ts
export interface ActiveForm {
  formId: string;
  command: string;
  description: string;
  createdAt: number;
  accumulatedArgs: Record<string, unknown>;
  commandPaths: string[];
  loadedKnowledgePaths: string[];
  // 新增字段
  status: "open" | "executing" | "executed";
  result?: string;
}
```

- `status` 缺失时按 "open" 解释（向后兼容，老 thread.json 不需要迁移）
- `result` 仅 `status="executed"` 时可能存在，且仅 program.shell 会真正写入；其它命令通常 `undefined`

### FormManager 方法语义

| 方法 | 行为 | 错误 |
|---|---|---|
| `open(command, description)` | 创建 form，status="open"，返回 formId | — |
| `refine(formId, args)` | 仅 status="open" 时累积 args；其它情形返回 null | refine.ts 区分两种 inject：formId 不存在 → `[错误] refine 失败：Form X 不存在。`；status 非 open → `[错误] refine 失败：Form X 不在 open 状态（当前 ${status}）。` |
| `submit(formId)` | 仅 status="open" 时 status→"executing"，**不移除 form**，返回 form；其它情形返回 null | submit.ts 区分两种 inject：formId 不存在 → `[错误] submit 失败：Form X 不存在。`；status 非 open → `[错误] submit 失败：Form X 不在 open 状态（当前 ${status}）。` |
| `markExecuted(formId, result?)` | 仅 status="executing" 时 status→"executed"，写入 result | 调用方契约错误，返回 null（不主动 inject，由调用方决定） |
| `close(formId)` | 任何 status 都从 forms 表移除，返回被移除的 form | 不存在返回 null；close.ts 注入现有的 `[提示] Form X 不存在` 文案 |

### handleSubmitTool 新流程

```ts
// 旧：submit → executeCommand → done
// 新：submit → executing → executeCommand → executed
async function handleSubmitTool(thread, args) {
  const formId = args.form_id;
  const formManager = FormManager.fromData(thread.activeForms ?? []);

  const form = formManager.submit(formId);
  if (!form) {
    inject "[错误] submit 失败：..."  // formId 不存在或不在 open 状态
    return;
  }
  thread.activeForms = formManager.toData();   // 持久化 status=executing

  inject `[form executing] formId=${formId} command=${form.command}`;

  const finalArgs = { ...form.accumulatedArgs, ...args };
  let result: string | undefined;
  try {
    result = await executeCommand(form.command, { thread, form, args: finalArgs });
  } catch (error) {
    // command 内部异常：标记 executed 但 result 含 [error]
    result = `[command-error] ${(error as Error).message}`;
  }

  formManager.markExecuted(formId, result);
  thread.activeForms = formManager.toData();   // 持久化 status=executed

  inject `[form executed] formId=${formId}`;
}
```

注意：command 内部异常被捕获，转为 result 字段。这避免了 thinkloop 的 try/catch 把整个 form 标 failed。LLM 看到 result 中的 `[command-error]` 自己决定是否重试或 close。

### executeCommand 签名变更

```ts
// 旧
export async function executeCommand(command: string, ctx: CommandExecutionContext): Promise<void>;

// 新
export async function executeCommand(command: string, ctx: CommandExecutionContext): Promise<string | undefined>;
```

- 各 command 实现：
  - `executeProgramCommand` → 返回 shell 输出格式化后的字符串
  - 其它 5 个 command（plan/todo/do/end/talk）返回 `undefined`
  - command 副作用（写 thread.plan / thread.status / push events）保持不变

### context 渲染变更

`renderActiveForms` 添加 status 属性 + 条件 result 段：

```ts
function renderActiveForms(forms: ActiveForm[] | undefined): string {
  // ...
  return `<form id="${escapeXml(form.formId)}" status="${form.status ?? "open"}">
    <command>${escapeXml(form.command)}</command>
    <description>${escapeXml(form.description)}</description>
    <accumulated_args>${escapeXml(JSON.stringify(form.accumulatedArgs))}</accumulated_args>
    ${commandPathsXml}
    ${loadedKnowledgeXml}
    ${form.status === "executed" && form.result ? `<result>${escapeXml(form.result)}</result>` : ""}
  </form>`;
}
```

向后兼容：`form.status ?? "open"` 处理老 thread.json 中没有 status 字段的 form。

---

## II. program.shell 实现

### 文件位置

直接在 `src/executable/commands/program.ts` 实现。**不**新建 `src/executable/program/runners/` 子目录——单一 mode 不值得目录化。将来加 typescript / function 模式时再讨论拆分。

### executeProgramCommand 实现

```ts
import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export async function executeProgramCommand(ctx: CommandExecutionContext): Promise<string | undefined> {
  const language = (ctx.args.language ?? ctx.args.lang) as string | undefined;
  const code = ctx.args.code as string | undefined;

  // 本阶段仅支持 shell；其它 mode 显式拒绝
  if (language !== "shell") {
    return `[program] 本阶段仅支持 language="shell"，收到 language="${language ?? "<undefined>"}"`;
  }
  if (typeof code !== "string" || code.trim() === "") {
    return `[program.shell] 缺少 code 参数`;
  }

  return runShell(code);
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

  const [stdoutRaw, stderrRaw] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return formatShellResult(code, stdoutRaw, stderrRaw, exitCode);
}

const MAX_OUTPUT_BYTES = 4096;

function truncate(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= MAX_OUTPUT_BYTES) return text;
  const head = new TextDecoder().decode(bytes.slice(0, MAX_OUTPUT_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

function formatShellResult(code: string, stdout: string, stderr: string, exitCode: number): string {
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  const lines = [`$ ${firstLine}`];
  if (stdout) lines.push("[stdout]", truncate(stdout));
  if (stderr) lines.push("[stderr]", truncate(stderr));
  // exitCode 为 124（timeout 约定）时单独标注
  lines.push(exitCode === 124 ? `[timeout 30s]` : `[exit ${exitCode}]`);
  return lines.join("\n");
}
```

### 安全 / 隔离边界

本阶段**不做**沙箱化：

- cwd = `process.cwd()`（项目根，bun 启动目录）
- env 继承 parent process
- 没有命令白名单
- 没有 user/uid 隔离

理由：单 object 阶段尚未引入 stone 目录概念，没有"对象自己的工作目录"作为更窄的 cwd 候选；OOC 当前是单机本地工具，不是多租户服务。等真要部署到多租户场景再讨论。这一点写进 program.doc.js 让维护者明确。

### program.doc.js 文档同步

更新 `meta/object/executable/actions/commands/program.doc.js` 的 index 文本，加一段"## 当前实现阶段"：

```
当前实现仅支持 language="shell"：
- 通过 sh -c 执行 code 字符串
- cwd 固定为项目根；env 继承 parent process
- 30s 超时、stdout/stderr 各 4KB 截断
- 输出归一化为单一 result 文本字符串，回写到 form.result

当前不支持：
- language="ts"/"js"（脚本沙箱）
- function 模式（调用 server export 方法）
- 命令白名单 / 沙箱隔离
```

---

## III. do.continue + wait 对称补全

### 修改位置

`src/executable/commands/do.ts` 的 continue 分支（findThread 之后，函数末尾）：

```ts
// continue 向现有线程追加消息；done/failed 线程收到新 inbox 后翻回 running。
if (!targetThreadId) return;
const targetThread = findThread(ctx.thread, targetThreadId);
if (!targetThread) return;

const message = generateMessage(ctx.thread.id, targetThreadId, content);
targetThread.inbox = [...(targetThread.inbox ?? []), message];
ctx.thread.outbox = [...(ctx.thread.outbox ?? []), message];

if (targetThread.status === "done" || targetThread.status === "failed") {
  targetThread.status = "running";
}

// 新增：与 fork 分支对称的 wait 处理
if (ctx.args.wait === true) {
  ctx.thread.status = "waiting";
  ctx.thread.waitingType = "await_children";
  ctx.thread.awaitingChildren = [targetThreadId];
}
```

### 文档同步

`meta/object/executable/actions/commands/do.doc.js` 的 KNOWLEDGE 文本里增加 continue + wait 的示例（具体文本由实现时同步）。

---

## IV. 文件改动清单

| 文件 | 改动 |
|---|---|
| `src/executable/forms/form.ts` | ActiveForm 加 status/result；FormManager.refine/submit 增加 status guard；新增 markExecuted；fromData 兼容 status 缺省 |
| `src/executable/tools/refine.ts` | refine 失败时区分"不存在"和"非 open 状态"两种错误注入 |
| `src/executable/tools/submit.ts` | 重写流程：submit → 注入 executing → executeCommand → markExecuted → 注入 executed |
| `src/executable/tools/close.ts` | 不变（任何 status 都允许 close） |
| `src/executable/commands/index.ts` | executeCommand 签名 `Promise<void>` → `Promise<string \| undefined>` |
| `src/executable/commands/program.ts` | 实现 executeProgramCommand（shell-only） |
| `src/executable/commands/plan.ts` | 显式 `return undefined` |
| `src/executable/commands/todo.ts` | 显式 `return undefined` |
| `src/executable/commands/do.ts` | continue 分支补 wait 处理；executeDoCommand 显式 `return undefined` |
| `src/executable/commands/end.ts` | 显式 `return undefined` |
| `src/executable/commands/talk.ts` | 显式 `return undefined` |
| `src/thinkable/context.ts` | renderActiveForms 加 status 属性 + 条件 result 段 |
| `meta/object/executable/actions/commands/program.doc.js` | 加"当前实现阶段"段 |
| `meta/object/executable/actions/commands/do.doc.js` | 补 continue+wait 示例 |
| `meta/object/executable/index.doc.js` | "渐进式披露"段中"submit 执行 → form 关闭"改为"submit → executing → command 完成 → executed → 由 LLM 显式 close 释放" |

---

## V. 集成测试套件

### 总体约定

**位置**：`tests/integration/*.integration.test.ts`（新建顶层 `tests/` 目录，与 `src/**/__tests__/` 并列）

**tsconfig.json 调整**：`include` 增加 `"tests/**/*.ts"`，否则 `bunx tsc --noEmit` 不会校验集成测试文件

**门控**：
```ts
const hasEnv = Boolean(process.env.OOC_API_KEY && process.env.OOC_BASE_URL && process.env.OOC_MODEL);
describe.skipIf(!hasEnv)("...", () => { ... });
```

**通用 fixture**：
```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createFlowObject, readThread } from "../../src/persistable";
import { runScheduler } from "../../src/thinkable/scheduler";
import { createLlmClient } from "../../src/thinkable/llm/client";
import type { ThreadContext } from "../../src/thinkable/context";

let tempRoot: string;
let llm = createLlmClient();

beforeEach(async () => { tempRoot = await mkdtemp(join(tmpdir(), "ooc-it-")); });
afterEach(async () => { await rm(tempRoot, { recursive: true, force: true }); });

async function makeRootThread(initialPrompt: string): Promise<ThreadContext> {
  const flow = await createFlowObject({ baseDir: tempRoot, sessionId: "s", objectId: "agent" });
  return {
    id: "root",
    status: "running",
    events: [
      { category: "context_change", kind: "inject", text: initialPrompt }
    ],
    persistence: { ...flow, threadId: "root" },
  };
}
```

**maxTicks**：默认 12，超过即测试 fail。需要更长的场景显式提高（如场景 9 设 20）。

**断言原则**：
- 不断言 LLM 中间步骤（哪一 tick 调了什么 tool）
- 只断言最终持久化状态：thread.status / thread.events 中特定 kind 的统计 / activeForms 残留 / 子线程存在性 / 文件落盘
- 数字类断言用区间（如 ".ts 文件数应在 [3, 50] 之间"）而非确定值，规避 LLM 把数字写错时整个测试 fail

### 场景表

| # | 文件 | 初始 prompt 大意 | 关键断言 |
|---|---|---|---|
| 1 | `shell-exec-basic.integration.test.ts` | 数 `src/persistable/` 下 .ts 文件数量 | thread.status="done" / events 至少 1 个 program executed / endSummary 非空 |
| 2 | `plan-then-execute.integration.test.ts` | 先做执行计划再数 .ts 文件 | thread.plan 非空 / events 含 plan executed + program executed / done |
| 3 | `multi-shell-chain.integration.test.ts` | 找 src/ 下最大 .ts 文件并 cat 前 20 行 | events 至少 2 个 program executed / 第二次 executed 时 args 含具体路径 / done |
| 4 | `abandon-via-close.integration.test.ts` | 故意 prompt：open program 然后立刻 close | events 含 form open + close / 该 formId 无 executed 事件 |
| 5 | `do-fork-and-collect.integration.test.ts` | 派子线程数 .ts 文件，等结果 | childThreads.size ≥ 1 / 子 status="done" / 子 thread.json 已落盘 / 父 status="done" |
| 6 | `wait-state-transition.integration.test.ts` | 进入 wait 等用户输入 | thread.status="waiting" / waitingType="explicit_wait" / scheduler 因无 running 退出 |
| 7 | `executed-form-cleanup.integration.test.ts` | 跑一次 ls 看完后 close 那个 form | events 含 program executed + close / 最终 activeForms 不含该 formId |
| 8 | `todo-driven-multistep.integration.test.ts` | 把两件事登记 todo，逐个完成并 submit todo | events 至少 2 个 todo executed + 2 个 program executed / done |
| 9 | `do-continue-after-done.integration.test.ts` | 派子做 task A，等结果后 continue+wait 追加 task B | 子 events 含 ≥ 2 个 program executed / 父 await_children 唤醒 ≥ 2 次 / 父 done |

### 断言细节示例（场景 1）

```ts
test("agent counts ts files via shell", async () => {
  const root = await makeRootThread(
    "请用 shell 命令查一下 src/persistable/ 下有几个 .ts 文件（不含 __tests__），告诉我数字然后 end。"
  );

  await runScheduler(root, llm, { maxTicks: 12 });

  expect(root.status).toBe("done");
  expect(root.endSummary).toBeDefined();

  const programExecuted = root.events.filter(
    (e) => e.category === "context_change" && e.kind === "inject" && e.text.startsWith("[form executed]")
  );
  expect(programExecuted.length).toBeGreaterThanOrEqual(1);

  // 验证持久化
  const restored = await readThread(root.persistence!, "root");
  expect(restored?.status).toBe("done");
});
```

### 断言细节示例（场景 9）

```ts
test("supervisor appends task to sub-agent via do.continue + wait", async () => {
  const root = await makeRootThread([
    "请派一个子线程执行 task A：'用 shell 数 src/persistable/ 下的 .ts 文件数'。",
    "等子线程完成后，再追加 task B：'数 src/thinkable/ 下的 .ts 文件数'。",
    "两件事都完成后，你再 end。",
  ].join("\n"));

  await runScheduler(root, llm, { maxTicks: 20 });

  expect(root.status).toBe("done");
  expect(root.childThreadIds?.length).toBe(1);

  const childId = root.childThreadIds![0]!;
  const child = root.childThreads![childId];
  expect(child.status).toBe("done");

  const childProgramExecuted = child.events.filter(
    (e) => e.category === "context_change" && e.kind === "inject" && e.text.startsWith("[form executed]")
  );
  expect(childProgramExecuted.length).toBeGreaterThanOrEqual(2);
});
```

### 未覆盖项及理由

| 项 | 覆盖方式 |
|---|---|
| talk command | 由现有 `commands-execution.test.ts:talk` 单元测试覆盖 |
| 命令超时 / exit ≠ 0 / 输出截断 / bad form_id | 新增 `program.test.ts` 单元测试覆盖（4 个 case） |
| scheduler lastExecutedAt 公平性 / await_children 唤醒 | 现有 `scheduler.test.ts` 单元测试覆盖 |
| 持久化字段 / readThread / debug 文件 | 现有 `persistable.test.ts` / `observable.test.ts` 单元测试覆盖 |

---

## VI. 设计取舍 / 自检（按 goal.md）

| goal.md 自检问题 | 答案 |
|---|---|
| 它在新系统里为什么存在 | program.shell 是 OOC 唯一的"对外行动"通道；form lifecycle 重构是为了让 LLM 直接看到行动进展 |
| 最小职责是什么 | program.shell：跑一段 shell code 并返回归一化字符串。form lifecycle：让 form 同时承载 args / 执行状态 / 结果 |
| 边界几句话说清 | program.shell 不做沙箱、不做 typescript/function 模式；form 不引入"重新提交"等高级能力 |
| 依赖哪些模块 | program 依赖 Bun.spawn；form 重构无新外部依赖；do.continue+wait 不引入新依赖 |
| 暂不迁会失去什么 | 没有 program → ReAct 退化成"自言自语"；没有 form lifecycle → LLM 必须翻 event log 找结果 |
| 迁入后系统更简单还是更复杂 | 简单：删除了 submit→立即移除 form 的隐式行为；引入的 3 个新概念（status/result/markExecuted）每个都直接服务用户述求；test 套件用真 LLM 替代了大量 stub LLM 模拟 |

| 引入的新概念 | 是否必要 | 替代方案为什么不行 |
|---|---|---|
| ActiveForm.status | 必要 | 没有它就只能用"form 在不在 active_forms"二态表达，但 executing 阶段就需要"在但还没结果" |
| ActiveForm.result | 必要 | 用户明确要求 form 能直接展示 result，不让 LLM 翻 event log |
| FormManager.markExecuted | 必要 | 是 status 状态机的写入端；不能塞进 submit 因为 submit 是 LLM 触发，markExecuted 是系统在 command 完成后触发 |

---

## VII. 非目标

- 不实现 program.typescript / .javascript / .function（显式 inject "本阶段仅支持 shell"）
- 不引入 shell 沙箱 / 命令白名单 / cwd 隔离
- 不实现 explicit_wait 的 inbox 唤醒（场景 6 不验证唤醒）
- 不实现跨 object talk
- 不实现 form 重新提交（executed → open 回退）
- 不引入 server export 注册机制（属于另一个独立子项目）
- 不实现 knowledge 加载 engine（loadedKnowledgePaths 仍只是字段）

---

## VIII. 实施顺序建议（供 plan 参考）

执行计划建议按这个顺序写：

1. **Form lifecycle 重构** — 改 form.ts + 改 refine/submit/close tool + 单元测试
2. **executeCommand 签名变更** — 改 commands/index.ts + 6 个 command 的返回类型
3. **program.shell 实现** + 4 个错误路径单元测试
4. **context 渲染加 status/result** + 渲染单元测试
5. **do.continue + wait 补全** + 单元测试
6. **文档同步**：program.doc.js / do.doc.js / forms 状态机说明
7. **集成测试基础设施**：tests/integration/ 目录 + 通用 fixture + skipIf 门控
8. **9 个集成测试场景**逐个落地
9. **最终验证**：`bun test` 全套通过 / `OOC_API_KEY=... bun test tests/integration` 全套通过 / `bunx tsc --noEmit` exit 0

---

## 附录：示例 LLM 视角的 context 片段

执行中：

```xml
<active_forms>
  <form id="f_xyz" status="executing">
    <command>program</command>
    <description>数 ts 文件</description>
    <accumulated_args>{"language":"shell","code":"find src/persistable -name '*.ts' | wc -l"}</accumulated_args>
    <command_paths><path>program</path><path>program.shell</path></command_paths>
  </form>
</active_forms>
```

执行完：

```xml
<active_forms>
  <form id="f_xyz" status="executed">
    <command>program</command>
    <description>数 ts 文件</description>
    <accumulated_args>{"language":"shell","code":"find src/persistable -name '*.ts' | wc -l"}</accumulated_args>
    <command_paths><path>program</path><path>program.shell</path></command_paths>
    <result>$ find src/persistable -name '*.ts' | wc -l
[stdout]
       9

[exit 0]</result>
  </form>
</active_forms>
```

LLM 下一轮看到这个 form 就知道该 close 了。
