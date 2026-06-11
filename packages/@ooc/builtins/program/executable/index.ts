/**
 * program_window — REPL 风格的代码执行窗口。
 */

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
} from "@ooc/core/extendable/_shared/types.js";
import { runOneExec, type ProgramExecArgs } from "./runtime.js";
export { runOneExec, type ProgramExecArgs } from "./runtime.js";
import type { ProgramWindow } from "../types.js";
import { DEFAULT_HISTORY_VIEWPORT } from "./history-viewport.js";
export {
  DEFAULT_HISTORY_VIEWPORT,
  programSetHistoryViewport,
  hasAnyHistoryViewportField,
} from "./history-viewport.js";

const EXEC_TIP = `program_window.exec 在已打开的 program_window 中再执行一段 shell/ts/js 代码。
参数：language（shell/ts/js，必填）、code（字符串，必填）。
每次 exec 都是独立 sandbox；结果追加到 program_window.history。`;

const CLOSE_TIP = `program_window.close 释放 window 与 history。不停止外部进程（每次 exec 都已结束）。`;

const execMethod: ObjectMethod = {
  description: "Execute another shell/ts/js snippet in this program window; result appended to history.",
  intents: ["exec.shell", "exec.ts", "exec.js"],
  schema: {
    args: {
      language: { type: "string", required: true, enum: ["shell", "ts", "js"], description: "Execution language" },
      lang: { type: "string", enum: ["shell", "ts", "js", "typescript", "javascript"], description: "Alias for language" },
      code: { type: "string", required: true, description: "Code string to execute" },
    },
  },
  onFormChange(change, { args }) {
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";
    const intents = [];
    if (lang === "shell") intents.push({ name: "exec.shell" });
    else if (lang === "ts" || lang === "typescript") intents.push({ name: "exec.ts" });
    else if (lang === "js" || lang === "javascript") intents.push({ name: "exec.js" });
    else intents.push({ name: "exec" });
    let tip = EXEC_TIP;
    let quick_exec_submit = false;
    if (lang && code) {
      quick_exec_submit = true;
    } else {
      tip = EXEC_TIP + "\n\n需要 language + code 两个参数。";
    }
    return { tip, intents, quick_exec_submit };
  },
  exec: (ctx) => executeProgramWindowExec(ctx),
};

const closeMethod: ObjectMethod = {
  description: "Close this program window and its history.",
  exec: () => undefined,
};

export async function executeProgramWindowExec(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[program_window.exec] 缺少 thread context。";
  const window = ctx.self as ProgramWindow;

  const args: ProgramExecArgs = {
    language: ctx.args.language as ProgramExecArgs["language"],
    code: ctx.args.code as string | undefined,
  };
  if (!(args.language && args.code)) {
    return "[program_window.exec] 缺少执行参数。请重新 exec(window_id=\"<program_window_id>\", method=\"exec\", args={ language: \"shell\"|\"ts\"|\"js\", code: \"...\" }) 一次性给齐参数。";
  }
  const record = await runOneExec(thread, args);

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

// ─────────────────────────── constructor ──────────────────────────

const PROGRAM_TIP = `program 执行一段 shell/ts/js 代码，返回 program_window（首次 exec 已跑完，结果进 history）。
参数：language（shell/ts/js，必填）、code（字符串，必填）。
- 改已有文件优先用 file_window.edit；新建文件用 write_file；搜索用 glob/grep。
- program(shell) 适合临时计算/探查；不要用 sed/awk/cat-redirect 改文件。`;

function deriveProgramTitle(args: ProgramExecArgs, max = 60): string {
  const summary =
    args.language && args.code
      ? `${args.language}: ${args.code.split("\n")[0] ?? ""}`
      : "program";
  return summary.length <= max ? summary : `${summary.slice(0, max)}...`;
}

const programConstructor: ObjectMethod = {
  kind: "constructor",
  description: "Execute a shell/ts/js snippet; result appears as a new program_window.",
  intents: ["program.shell", "program.ts", "program.js"],
  permission: () => "allow",
  schema: {
    args: {
      language: { type: "string", required: true, enum: ["shell", "ts", "js"], description: "Execution language" },
      lang: { type: "string", enum: ["shell", "ts", "js", "typescript", "javascript"], description: "Alias for language" },
      code: { type: "string", required: true, description: "Code string to execute" },
    },
  },
  onFormChange(change, { args }) {
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";
    const intents = [];
    if (lang === "shell") intents.push({ name: "program.shell" });
    else if (lang === "ts" || lang === "typescript") intents.push({ name: "program.ts" });
    else if (lang === "js" || lang === "javascript") intents.push({ name: "program.js" });
    else intents.push({ name: "program" });
    let tip = PROGRAM_TIP;
    let quick_exec_submit = false;
    if (lang && code) {
      quick_exec_submit = true;
    } else {
      const missing: string[] = [];
      if (!lang) missing.push("language");
      if (!code) missing.push("code");
      tip = PROGRAM_TIP + `\n\n还缺参数: ${missing.join(", ")}。用 refine 补齐。`;
    }
    return { tip, intents, quick_exec_submit };
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
      class: "program",
      parentWindowId: ROOT_WINDOW_ID,
      title: deriveProgramTitle(execArgs),
      status: "open",
      createdAt: Date.now(),
      history: [record],
      state: { historyViewport: DEFAULT_HISTORY_VIEWPORT },
    };
    return { ok: true, window: programWindow };
  },
};

builtinRegistry.registerExecutable("program", {
  methods: {
    exec: execMethod,
    close: closeMethod,
    program: programConstructor,
  },
});
