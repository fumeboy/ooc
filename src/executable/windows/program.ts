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
  CommandTableEntry,
} from "./command-types.js";
import { registerWindowType } from "./registry.js";
import { runOneExec, type ProgramExecArgs } from "./program-runtime.js";
import type { ProgramWindow } from "./types.js";

const PROGRAM_WINDOW_EXEC_BASIC = "internal/windows/program/exec/basic";
const PROGRAM_WINDOW_EXEC_INPUT = "internal/windows/program/exec/input";
const PROGRAM_WINDOW_CLOSE_BASIC = "internal/windows/program/close/basic";

const EXEC_KNOWLEDGE = `
program_window.exec 用于在已打开的 program_window 中再次执行一段代码或函数。

参数（与 root.program 相同）：
- language: shell / ts / js（与 code 配合）
- code: 待执行代码字符串
- function: 目标 server 方法名
- args: function 模式的参数对象

每次 exec 都是独立 sandbox：
- shell：起新进程
- ts/js：每次新加载用户代码模块；可通过 self.getThreadLocal/setThreadLocal 跨 exec 共享数据
- function：调 server method（每次都是 fresh callMethod 调用）

执行结果会追加到 program_window.history；窗口本身保留打开。
`.trim();

const CLOSE_KNOWLEDGE = `
program_window.close 等价于 close tool；释放 window 与 history。
不会停止任何外部进程（每次 exec 都已经结束）。
`.trim();

const execCommand: CommandTableEntry = {
  paths: ["exec", "exec.shell", "exec.ts", "exec.js", "exec.function"],
  match: (args) => {
    const hit: string[] = ["exec"];
    const lang = (args.language ?? args.lang) as string | undefined;
    if (lang === "shell") hit.push("exec.shell");
    if (lang === "ts" || lang === "typescript") hit.push("exec.ts");
    if (lang === "js" || lang === "javascript") hit.push("exec.js");
    if (typeof args.function === "string") hit.push("exec.function");
    return hit;
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [PROGRAM_WINDOW_EXEC_BASIC]: EXEC_KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";
    const fn = typeof args.function === "string" ? args.function : "";
    if (!fn && !(lang && code)) {
      entries[PROGRAM_WINDOW_EXEC_INPUT] =
        "program_window.exec 缺少执行参数；refine(args={ language, code }) 或 refine(args={ function, args })。";
    }
    return entries;
  },
  exec: (ctx) => executeProgramWindowExec(ctx),
};

const closeCommand: CommandTableEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): CommandKnowledgeEntries => ({ [PROGRAM_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE }),
  exec: () => undefined,
};

/** program_window.exec：跑一次 exec，把 record append 到 window.history。 */
export async function executeProgramWindowExec(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[program_window.exec] 缺少 thread context。";
  const window = ctx.parentWindow;
  if (!window || window.type !== "program") {
    return "[program_window.exec] 未挂载在 program_window 上。";
  }

  const args: ProgramExecArgs = {
    language: ctx.args.language as ProgramExecArgs["language"],
    code: ctx.args.code as string | undefined,
    function: ctx.args.function as string | undefined,
    args: ctx.args.args as Record<string, unknown> | undefined,
  };
  if (!args.function && !(args.language && args.code)) {
    return "[program_window.exec] 缺少执行参数。submit 后 form 已 executed, 请 close(form_id) 后重新 open(parent_window_id=\"<program_window_id>\", command=\"exec\", args={ language: \"shell\"|\"ts\"|\"js\", code: \"...\" }) 或 open(..., args={ function: \"<name>\", args: {...} }) 一次性给齐参数; 下次直接在 open 时附 args 可避免再次进入失败回路。";
  }
  const record = await runOneExec(thread, args);

  // 把 record 追加到 window.history；通过 manager 重新插入以保证 toData() 写回
  if (ctx.manager) {
    const next: ProgramWindow = {
      ...window,
      history: [...window.history, record],
    };
    // 直接 mutate 更直接（manager 内部 map 已有引用）
    Object.assign(window, next);
  } else {
    window.history.push(record);
  }
  return undefined;
}

registerWindowType("program", {
  commands: {
    exec: execCommand,
    close: closeCommand,
  },
});
