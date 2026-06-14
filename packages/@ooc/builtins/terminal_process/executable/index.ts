/**
 * terminal_process — bash 进程窗（非单例 builtin class）。
 *
 * 由 terminal 对象的 run 方法构造（首 exec 已跑完，结果进 history）。窗本身再注册
 * exec（追加一段 bash）/ close / set_history_window。原 program 包的 shell 路径拆到此。
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
import { runBashExec } from "./runtime.js";
export { runBashExec } from "./runtime.js";
import type { TerminalProcessWindow } from "../types.js";
import {
  renderProcessHistory,
  makeSetHistoryWindowMethod,
} from "@ooc/builtins/_shared/executable/process-readable.js";
import { DEFAULT_HISTORY_VIEWPORT } from "@ooc/builtins/_shared/executable/process-history-viewport.js";

const EXEC_TIP = `terminal_process.exec 在已打开的 terminal_process 中再跑一段 bash 脚本。
参数：code（字符串，必填）。每次 exec 都是独立子进程；结果追加到 history。`;

const execMethod: ObjectMethod = {
  description: "Run another bash script in this terminal process; result appended to history.",
  intents: ["exec.shell"],
  schema: {
    args: {
      code: { type: "string", required: true, description: "待执行 bash 脚本" },
    },
  },
  onFormChange(_change, { args }) {
    const code = typeof args.code === "string" ? args.code.trim() : "";
    const ready = Boolean(code);
    return {
      tip: ready ? "Running bash..." : EXEC_TIP,
      intents: [{ name: "exec.shell" }],
      quick_exec_submit: ready,
    };
  },
  exec: (ctx) => executeTerminalProcessExec(ctx),
};

const closeMethod: ObjectMethod = {
  description: "Close this terminal process window and its history.",
  exec: () => undefined,
};

export async function executeTerminalProcessExec(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[terminal_process.exec] 缺少 thread context。";
  const window = ctx.self as TerminalProcessWindow;
  const code = ctx.args.code as string | undefined;
  if (typeof code !== "string" || code.trim() === "") {
    return "[terminal_process.exec] 缺少 code 参数。请重新 exec(window_id=\"<terminal_process_id>\", method=\"exec\", args={ code: \"...\" })。";
  }
  const record = await runBashExec(thread, code);
  if (ctx.manager) {
    Object.assign(window, { ...window, history: [...window.history, record] });
  } else {
    window.history.push(record);
  }
  return undefined;
}

// ─────────────────────────── constructor ──────────────────────────

const RUN_TIP = `run 跑一段 bash 脚本，返回 terminal_process（首次 exec 已跑完，结果进 history）。
参数：code（字符串，必填）。
- 改已有文件优先用 file_window.edit；新建文件用 write_file；搜索用 glob/grep。
- bash 适合临时计算/探查；不要用 sed/awk/cat-redirect 改文件。`;

function deriveTitle(code: string | undefined, max = 60): string {
  const summary = code ? `shell: ${code.split("\n")[0] ?? ""}` : "terminal_process";
  return summary.length <= max ? summary : `${summary.slice(0, max)}...`;
}

const runConstructor: ObjectMethod = {
  kind: "constructor",
  description: "Run a bash script; result appears as a new terminal_process window.",
  intents: ["run.shell"],
  permission: () => "allow",
  schema: {
    args: {
      code: { type: "string", required: true, description: "待执行 bash 脚本" },
    },
  },
  onFormChange(_change, { args }) {
    const code = typeof args.code === "string" ? args.code.trim() : "";
    const ready = Boolean(code);
    return {
      tip: ready ? "Running bash..." : RUN_TIP,
      intents: [{ name: "run.shell" }],
      quick_exec_submit: ready,
    };
  },
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[terminal_process] 缺少 thread context。" };
    const code = ctx.args.code as string | undefined;
    if (typeof code !== "string" || code.trim() === "") {
      return { ok: false, error: "[terminal_process] 缺少 code 参数。" };
    }
    const record = await runBashExec(thread, code);
    const window: TerminalProcessWindow = {
      id: generateWindowId("terminal_process"),
      class: "terminal_process",
      parentWindowId: ROOT_WINDOW_ID,
      title: deriveTitle(code),
      status: "open",
      createdAt: Date.now(),
      history: [record],
      state: { historyViewport: DEFAULT_HISTORY_VIEWPORT },
    };
    return { ok: true, window };
  },
};

// terminal_process 类的单处声明：executable（methods + constructor）+ readable + window method。
builtinRegistry.registerWindowClass({
  type: "terminal_process",
  parentClass: null,
  methods: {
    exec: execMethod,
    close: closeMethod,
    run: runConstructor,
  },
  readable: renderProcessHistory,
  windowMethods: {
    set_history_window: makeSetHistoryWindowMethod("terminal_process.set_history_window"),
  },
  renderableVisible: true,
  builtinReadable: true,
});
