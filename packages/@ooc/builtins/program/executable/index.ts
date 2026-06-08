/**
 * program_window — REPL 风格的代码执行窗口。
 *
 * spec § program_window：
 * - 由 root.program 创建（首次 exec 已在 root.program submit 时跑完）
 * - 注册的 command：exec / close
 *   - exec：起独立 sandbox 运行（与首次 exec 同一路径），结果追加到 history
 *   - close：onClose 释放 window；不停止任何外部进程（每次 exec 都已结束）
 * - 跨 exec 的 ts/js 数据通过 thread.threadLocalData（self.getThreadLocal/setThreadLocal）
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import type { WindowMethod } from "@ooc/core/_shared/types/window-method.js";
import type { Intent, MethodCallSchema } from "@ooc/core/thinkable/context/intent.js";
import type { ContextWindow } from "@ooc/core/executable/windows/_shared/types.js";
import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { emptyIntent } from "@ooc/builtins/_shared/executable/utils.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
} from "@ooc/core/extendable/_shared/types.js";
import { runOneExec, type ProgramExecArgs } from "./runtime.js";
export { runOneExec, type ProgramExecArgs } from "./runtime.js";
import type { ProgramWindow } from "../types.js";
import {
  DEFAULT_HISTORY_VIEWPORT,
  programSetHistoryViewport,
  hasAnyHistoryViewportField,
} from "./history-viewport.js";
export {
  DEFAULT_HISTORY_VIEWPORT,
  programSetHistoryViewport,
  hasAnyHistoryViewportField,
} from "./history-viewport.js";
import { readable } from "../readable.js";


const PROGRAM_WINDOW_EXEC_BASIC = "internal/windows/program/exec/basic";
const PROGRAM_WINDOW_EXEC_INPUT = "internal/windows/program/exec/input";
const PROGRAM_WINDOW_CLOSE_BASIC = "internal/windows/program/close/basic";
const PROGRAM_WINDOW_SET_HISTORY_BASIC = "internal/windows/program/set_history_window/basic";
const PROGRAM_WINDOW_SET_HISTORY_INPUT = "internal/windows/program/set_history_window/input";

const EXEC_KNOWLEDGE = `
program_window.exec 用于在已打开的 program_window 中再次执行一段 shell / ts / js 代码。

参数（与 root.program 相同）：
- language: shell / ts / js（与 code 配合，必填）
- code: 待执行代码字符串（必填）

每次 exec 都是独立 sandbox：
- shell：起新进程
- ts/js：每次新加载用户代码模块；可通过 self.getThreadLocal/setThreadLocal 跨 exec 共享数据；
  ts/js 内仍可 \`await self.callMethod("custom:<self>", "<name>", {...})\` 调命令

执行结果会追加到 program_window.history；窗口本身保留打开。

要调任意 window 上的命令请直接用顶层 \`exec\` tool；program_window.exec 只用来跑代码。

渲染层默认按 historyViewport={ tail: 10 } 只展示末 10 次 exec；\`<history_viewport total=N tail=10 earlier_omitted=M/>\`
元节点暴露省略数；想看其它区间用 set_history_window；last_output 始终是最近一次 exec（不受 viewport 影响）。
`.trim();

const CLOSE_KNOWLEDGE = `
program_window.close 等价于 close tool；释放 window 与 history。
不会停止任何外部进程（每次 exec 都已经结束）。
`.trim();

const SET_HISTORY_KNOWLEDGE = `
program_window.set_history_window 精细化调整 exec history 渲染视口。

打开 program_window 时默认 historyViewport = { tail: 10 } —— 只渲染末 10 次 exec；
更早的 exec 以 \`<history_viewport tail=10 total=42 earlier_omitted=32/>\` 形式提示前部还有多少条。

参数（**择一传**，二选一）：
- history_tail: 末 N 次（必须是正整数）
- history_start + history_end: 固定区间 history[history_start, history_end)（非负整数；history_start ≤ history_end；必须同时出现）

**history_tail 与 history_start/history_end 互斥**：传 history_tail 的 args 清空 range；传 range 的 args 清空 tail。

约束（fail-loud）：
- history_tail 必须是正整数（>= 1）
- history_start / history_end 必须是非负整数
- history_start ≤ history_end
- history_start 与 history_end 必须同时出现

例：
- exec(window_id="<id>", method="set_history_window", args={ history_tail: 30 })          → 看末 30 次 exec
- exec(..., args={ history_start: 0, history_end: 5 })                                     → 看前 5 次
- exec(..., args={ history_start: 10, history_end: 20 })                                   → 看中间 10 次

**注意**：viewport 只影响**渲染**给 LLM 的 history summary 与 last_output 锚点；
后续 exec 仍正常追加到完整 history（不受 viewport 影响）。
`.trim();

const execMethod: ObjectMethod = {
  paths: ["exec", "exec.shell", "exec.ts", "exec.js"],
  schema: {
    args: {
      language: { type: "string", required: true, enum: ["shell", "ts", "js"], description: "Execution language" },
      lang: { type: "string", enum: ["shell", "ts", "js", "typescript", "javascript"], description: "Alias for language" },
      code: { type: "string", required: true, description: "Code string to execute" },
    },
  },
  intent: (args) => {
    const intents: Intent[] = [];
    const lang = (args.language ?? args.lang) as string | undefined;
    if (lang === "shell") intents.push({ name: "exec.shell" });
    if (lang === "ts" || lang === "typescript") intents.push({ name: "exec.ts" });
    if (lang === "js" || lang === "javascript") intents.push({ name: "exec.js" });
    return intents;
  },
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [PROGRAM_WINDOW_EXEC_BASIC]: EXEC_KNOWLEDGE };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";
    if (!(lang && code)) {
      entries[PROGRAM_WINDOW_EXEC_INPUT] =
        "program_window.exec 缺少执行参数；refine(args={ language, code })。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => executeProgramWindowExec(ctx),
};

const closeMethod: ObjectMethod = {
  paths: ["close"],
  intent: emptyIntent,
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    const entries: Record<string, string> = { [PROGRAM_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE };
    return buildGuidanceWindows(form, entries);
  },
  exec: () => undefined,
};

const setHistoryWindowMethod: WindowMethod = {
  kind: "window",
  paths: ["set_history_window"],
  schema: {
    args: {
      history_tail: { type: "number", description: "Show last N execs (positive integer; mutually exclusive with history_start/history_end)" },
      history_start: { type: "number", description: "Start of range (non-negative integer; must pair with history_end)" },
      history_end: { type: "number", description: "End of range (non-negative integer; must pair with history_start)" },
    },
  },
  intent: emptyIntent,
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [PROGRAM_WINDOW_SET_HISTORY_BASIC]: SET_HISTORY_KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyHistoryViewportField(args)) {
      entries[PROGRAM_WINDOW_SET_HISTORY_INPUT] =
        "set_history_window 至少需要传入 history_tail / history_start+history_end 之一。\n" +
        "history_tail 与 history_start/history_end 互斥，请 refine 后 submit。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => programSetHistoryViewport(ctx),
};

/** program_window.exec：跑一次 exec，把 record append 到 window.history。 */
export async function executeProgramWindowExec(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[program_window.exec] 缺少 thread context。";
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "program"，method 体不再 re-check。
  const window = ctx.self as ProgramWindow;

  const args: ProgramExecArgs = {
    language: ctx.args.language as ProgramExecArgs["language"],
    code: ctx.args.code as string | undefined,
  };
  if (!(args.language && args.code)) {
    return "[program_window.exec] 缺少执行参数。请重新 exec(window_id=\"<program_window_id>\", method=\"exec\", args={ language: \"shell\"|\"ts\"|\"js\", code: \"...\" }) 一次性给齐参数。";
  }
  const record = await runOneExec(thread, args);

  // 把 record 追加到 window.history；通过 manager 重新插入以保证 toData() 写回
  if (ctx.manager) {
    const next: ProgramWindow = {
      ...window,
      history: [...window.history, record],
    };
    Object.assign(window, next);
  } else {
    window.history.push(record);
  }
  return undefined;
}

/** program_window 的 renderXml hook 已迁出到 ../readable.ts。 */

// ─────────────────────────── constructor (P6.§4-§5) ──────────────────────────

const PROGRAM_CONSTRUCTOR_BASIC = "internal/objects/program/constructor/basic";
const PROGRAM_CONSTRUCTOR_INPUT = "internal/objects/program/constructor/input";
const PROGRAM_CONSTRUCTOR_FORM_STATUS = "internal/objects/program/constructor/form-status";

const PROGRAM_CONSTRUCTOR_KNOWLEDGE = `
program 用于执行一段 shell / ts / js 代码；submit 后产出一个 program_window，
首次 exec 立即跑完，结果进 program_window.history。后续 exec 通过该 window 的
\`exec\` command 触发。

参数（首次 exec）：
- language: shell / ts / js（与 code 配合，必填）
- code: 待执行代码字符串（必填）

shell 环境变量：
- shell 命令的 cwd 是 OOC 进程的工作目录
- 想读写自己的 stone 目录（self.dir），用 env $OOC_SELF_DIR

ts/js 上下文：
- self.dir / self.callMethod(windowId, command, args?) / self.getData / self.setData 可用
- 跨 exec 共享：self.getThreadLocal(key) / self.setThreadLocal(key, value)
- shell 之间不共享 threadLocal（OS 进程隔离），需要时自行写入 stone data

后续多次执行：
- exec(window_id="<program_window_id>", method="exec", args={ language, code })

调用示例：
exec(method="program", title="统计 ts 文件数量", args={ language: "shell", code: "find src -name '*.ts' | wc -l" })

要调任意 window 上的命令请直接用顶层 \`exec\` tool（不再走 program）；
ts/js sandbox 内仍可 \`await self.callMethod("custom:<self>", "<name>", {...})\` 编排多步调用。

## 建议

- 修改已有文件优先使用 \`file_window.edit\`（在已 open 的 file_window 上做 oldString→newString 精确替换；支持 atomic 多点修改）
- 新建文件优先使用 \`root.write_file\`（一步写盘 + 自动 spawn file_window）
- 搜索文件名优先使用 \`root.glob\`；搜索文件内容优先使用 \`root.grep\`（结果是结构化 search_window，可被 open_match 直接打开）
- \`program(language="shell")\` 适合临时计算 / 不修改 worktree 的探查（统计、查询版本、跑测试）；**不要用 shell sed / awk / cat-redirect 改文件**——会失去 file_window 的版本可见性，且转义容易出错
`.trim();

function deriveProgramTitle(args: ProgramExecArgs, max = 60): string {
  const summary =
    args.language && args.code
      ? `${args.language}: ${args.code.split("\n")[0] ?? ""}`
      : "program";
  return summary.length <= max ? summary : `${summary.slice(0, max)}...`;
}

/**
 * P6.§4-§5 constructor —— 创建 program_window + 跑首次 exec。
 *
 * args:
 *  - language: "shell" | "ts" | "js" (必填)
 *  - code: string (必填)
 *
 * 行为:
 *  - validate language+code 两个参数都非空
 *  - 调 runOneExec(thread, args) 跑第一次执行
 *  - generateWindowId("program") + build ProgramWindow，history=[record]
 *  - 返回 { ok: true, object: programWindow }
 *
 * P6 mark: kind="constructor"，manager.submit §2 分支挂载。
 */
const programConstructor: ObjectMethod = {
  kind: "constructor",
  paths: ["program", "program.shell", "program.ts", "program.js"],
  permission: () => "allow",
  schema: {
    args: {
      language: { type: "string", required: true, enum: ["shell", "ts", "js"], description: "Execution language" },
      lang: { type: "string", enum: ["shell", "ts", "js", "typescript", "javascript"], description: "Alias for language" },
      code: { type: "string", required: true, description: "Code string to execute" },
    },
  },
  intent: (args) => {
    const intents: Intent[] = [];
    const lang = (args.language ?? args.lang) as string | undefined;
    if (lang === "shell") intents.push({ name: "program.shell" });
    if (lang === "ts" || lang === "typescript") intents.push({ name: "program.ts" });
    if (lang === "js" || lang === "javascript") intents.push({ name: "program.js" });
    return intents;
  },
  onFormChange(change, { form }) {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = {
      [PROGRAM_CONSTRUCTOR_BASIC]: PROGRAM_CONSTRUCTOR_KNOWLEDGE,
    };
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";
    if (formStatus === "executing") {
      entries[PROGRAM_CONSTRUCTOR_FORM_STATUS] =
        "对于 command program 的 executing 状态的 form，应等待 result 写入后再继续，不要再次 refine 或 submit。";
      return buildGuidanceWindows(form, entries);
    }
    if (formStatus === "success") {
      entries[PROGRAM_CONSTRUCTOR_FORM_STATUS] =
        "对于 command program 的 success 状态的 form，结果已成功生成；form 将自动从 context 移除。";
      return buildGuidanceWindows(form, entries);
    }
    if (formStatus === "failed") {
      entries[PROGRAM_CONSTRUCTOR_FORM_STATUS] =
        "对于 command program 的 failed 状态的 form，先阅读 result 排查错误：可 refine(form_id, args={ language, code }) 修正参数后重 submit（form 会自动切回 open），或 close(form_id, reason=...) 彻底放弃。";
      return buildGuidanceWindows(form, entries);
    }
    if (lang && code) {
      entries[PROGRAM_CONSTRUCTOR_INPUT] =
        "program 参数已具备；submit 即创建 program_window 并执行。";
      return buildGuidanceWindows(form, entries);
    }
    const missing: string[] = [];
    if (!lang) missing.push("language");
    if (!code) missing.push("code");
    entries[PROGRAM_CONSTRUCTOR_INPUT] =
      `program 还缺以下参数: ${missing.join(", ")}。\n` +
      "请用 refine(form_id, args={ language: \"shell\" | \"ts\" | \"js\", code: \"<待执行代码>\" }) 补齐后 submit(form_id)。\n" +
      "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    return buildGuidanceWindows(form, entries);
  },
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[program] 缺少 thread context。" };
    const execArgs: ProgramExecArgs = {
      language: ctx.args.language as ProgramExecArgs["language"],
      code: ctx.args.code as string | undefined,
    };
    if (!(execArgs.language && execArgs.code)) {
      return { ok: false, error: "[program] 缺少执行参数；需要 language+code。" };
    }
    const record = await runOneExec(thread, execArgs);
    const programWindow: ProgramWindow = {
      id: generateWindowId("program"),
      type: "program",
      parentWindowId: ROOT_WINDOW_ID,
      title: deriveProgramTitle(execArgs),
      status: "open",
      createdAt: Date.now(),
      history: [record],
      state: { historyViewport: DEFAULT_HISTORY_VIEWPORT },
    };
    return { ok: true, object: programWindow };
  },
};

builtinRegistry.registerObjectType("program", {
  methods: {
    exec: execMethod,
    close: closeMethod,
    program: programConstructor,
  },
  windowMethods: {
    set_history_window: setHistoryWindowMethod,
  },
  readable,
});
