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
  CommandExecutionContext,
  CommandKnowledgeEntries,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/command-types.js";
import { registerObjectType } from "@ooc/core/extendable/_shared/registry.js";
import { runOneExec, type ProgramExecArgs } from "./runtime.js";
export { runOneExec, type ProgramExecArgs } from "./runtime.js";
import type { ProgramWindow } from "../types.js";
import {
  DEFAULT_HISTORY_VIEWPORT,
  executeProgramSetHistoryViewport,
  hasAnyHistoryViewportField,
} from "./history-viewport.js";
export {
  DEFAULT_HISTORY_VIEWPORT,
  executeProgramSetHistoryViewport,
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
  ts/js 内仍可 \`await self.callCommand("custom:<self>", "<name>", {...})\` 调命令

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
- exec(window_id="<id>", command="set_history_window", args={ history_tail: 30 })          → 看末 30 次 exec
- exec(..., args={ history_start: 0, history_end: 5 })                                     → 看前 5 次
- exec(..., args={ history_start: 10, history_end: 20 })                                   → 看中间 10 次

**注意**：viewport 只影响**渲染**给 LLM 的 history summary 与 last_output 锚点；
后续 exec 仍正常追加到完整 history（不受 viewport 影响）。
`.trim();

const execCommand: ObjectMethod = {
  paths: ["exec", "exec.shell", "exec.ts", "exec.js"],
  match: (args) => {
    const hit: string[] = ["exec"];
    const lang = (args.language ?? args.lang) as string | undefined;
    if (lang === "shell") hit.push("exec.shell");
    if (lang === "ts" || lang === "typescript") hit.push("exec.ts");
    if (lang === "js" || lang === "javascript") hit.push("exec.js");
    return hit;
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [PROGRAM_WINDOW_EXEC_BASIC]: EXEC_KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";
    if (!(lang && code)) {
      entries[PROGRAM_WINDOW_EXEC_INPUT] =
        "program_window.exec 缺少执行参数；refine(args={ language, code })。";
    }
    return entries;
  },
  exec: (ctx) => executeProgramWindowExec(ctx),
};

const closeCommand: ObjectMethod = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): CommandKnowledgeEntries => ({ [PROGRAM_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  exec: () => undefined,
};

const setHistoryWindowCommand: ObjectMethod = {
  paths: ["set_history_window"],
  match: () => ["set_history_window"],
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = {
      [PROGRAM_WINDOW_SET_HISTORY_BASIC]: SET_HISTORY_KNOWLEDGE,
    };
    if (formStatus === "open" && !hasAnyHistoryViewportField(args)) {
      entries[PROGRAM_WINDOW_SET_HISTORY_INPUT] =
        "set_history_window 至少需要传入 history_tail / history_start+history_end 之一。\n" +
        "history_tail 与 history_start/history_end 互斥，请 refine 后 submit。";
    }
    return entries;
  },
  exec: (ctx) => executeProgramSetHistoryViewport(ctx),
};

/** program_window.exec：跑一次 exec，把 record append 到 window.history。 */
export async function executeProgramWindowExec(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[program_window.exec] 缺少 thread context。";
  const window = ctx.self;
  if (!window || window.type !== "program") {
    return "[program_window.exec] 未挂载在 program_window 上。";
  }

  const args: ProgramExecArgs = {
    language: ctx.args.language as ProgramExecArgs["language"],
    code: ctx.args.code as string | undefined,
  };
  if (!(args.language && args.code)) {
    return "[program_window.exec] 缺少执行参数。请重新 exec(window_id=\"<program_window_id>\", command=\"exec\", args={ language: \"shell\"|\"ts\"|\"js\", code: \"...\" }) 一次性给齐参数。";
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

registerObjectType("program", {
  commands: {
    exec: execCommand,
    close: closeCommand,
    set_history_window: setHistoryWindowCommand,
  },
  readable,
});
