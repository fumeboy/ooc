/**
 * interpreter_process — ts/js 解释进程窗（非单例 builtin class）。
 *
 * 由 interpreter 对象的 run 方法构造（首 exec 已跑完，结果进 history）。窗本身再注册
 * exec（追加一段 ts/js）/ close / set_history_window。原 program 包的 ts/js 路径拆到此。
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
import { runInterpreterExec, type InterpreterLang } from "./runtime.js";
export { runInterpreterExec } from "./runtime.js";
import type { InterpreterProcessWindow } from "../types.js";
import {
  renderProcessHistory,
  makeSetHistoryWindowMethod,
} from "@ooc/builtins/_shared/executable/process-readable.js";
import { DEFAULT_HISTORY_VIEWPORT } from "@ooc/builtins/_shared/executable/process-history-viewport.js";

const LANG_ENUM = ["ts", "typescript", "js", "javascript"];

const EXEC_TIP = `interpreter_process.exec 在已打开的 interpreter_process 中再跑一段 ts/js 脚本。
参数：language（ts/js，必填）、code（字符串，必填）。每次 exec 都是独立 sandbox；结果追加到 history。`;

function normLang(args: Record<string, unknown>): InterpreterLang | undefined {
  return (args.language ?? args.lang) as InterpreterLang | undefined;
}

const execMethod: ObjectMethod = {
  description: "Run another ts/js snippet in this interpreter process; result appended to history.",
  intents: ["exec.ts", "exec.js"],
  schema: {
    args: {
      language: { type: "string", required: true, enum: LANG_ENUM, description: "ts / js" },
      lang: { type: "string", enum: LANG_ENUM, description: "Alias for language" },
      code: { type: "string", required: true, description: "Code string to execute" },
    },
  },
  onFormChange(_change, { args }) {
    const lang = normLang(args);
    const code = typeof args.code === "string" ? args.code.trim() : "";
    const intents = lang === "js" || lang === "javascript" ? [{ name: "exec.js" }] : [{ name: "exec.ts" }];
    const ready = Boolean(lang && code);
    return { tip: ready ? `Running ${lang}...` : EXEC_TIP, intents, quick_exec_submit: ready };
  },
  exec: (ctx) => executeInterpreterProcessExec(ctx),
};

const closeMethod: ObjectMethod = {
  description: "Close this interpreter process window and its history.",
  exec: () => undefined,
};

export async function executeInterpreterProcessExec(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[interpreter_process.exec] 缺少 thread context。";
  const window = ctx.self as InterpreterProcessWindow;
  const lang = normLang(ctx.args);
  const code = ctx.args.code as string | undefined;
  if (!(lang && code)) {
    return "[interpreter_process.exec] 缺少执行参数。请重新 exec(window_id=\"<interpreter_process_id>\", method=\"exec\", args={ language: \"ts\"|\"js\", code: \"...\" })。";
  }
  const record = await runInterpreterExec(thread, lang, code);
  if (ctx.manager) {
    Object.assign(window, { ...window, history: [...window.history, record] });
  } else {
    window.history.push(record);
  }
  return undefined;
}

// ─────────────────────────── constructor ──────────────────────────

const RUN_TIP = `run 跑一段 ts/js 脚本，返回 interpreter_process（首次 exec 已跑完，结果进 history）。
参数：language（ts/js，必填）、code（字符串，必填）。
- ts/js 适合临时计算/编排；调命令用顶层 exec，多步编排可用 self.callMethod。`;

function deriveTitle(lang: InterpreterLang | undefined, code: string | undefined, max = 60): string {
  const summary = lang && code ? `${lang}: ${code.split("\n")[0] ?? ""}` : "interpreter_process";
  return summary.length <= max ? summary : `${summary.slice(0, max)}...`;
}

const runConstructor: ObjectMethod = {
  kind: "constructor",
  description: "Run a ts/js snippet; result appears as a new interpreter_process window.",
  intents: ["run.ts", "run.js"],
  permission: () => "allow",
  schema: {
    args: {
      language: { type: "string", required: true, enum: LANG_ENUM, description: "ts / js" },
      lang: { type: "string", enum: LANG_ENUM, description: "Alias for language" },
      code: { type: "string", required: true, description: "Code string to execute" },
    },
  },
  onFormChange(_change, { args }) {
    const lang = normLang(args);
    const code = typeof args.code === "string" ? args.code.trim() : "";
    const intents = lang === "js" || lang === "javascript" ? [{ name: "run.js" }] : [{ name: "run.ts" }];
    const ready = Boolean(lang && code);
    return { tip: ready ? `Running ${lang}...` : RUN_TIP, intents, quick_exec_submit: ready };
  },
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[interpreter_process] 缺少 thread context。" };
    const lang = normLang(ctx.args);
    const code = ctx.args.code as string | undefined;
    if (!(lang && code)) {
      return { ok: false, error: "[interpreter_process] 缺少执行参数；需要 language+code。" };
    }
    const record = await runInterpreterExec(thread, lang, code);
    const window: InterpreterProcessWindow = {
      id: generateWindowId("interpreter_process"),
      class: "interpreter_process",
      parentWindowId: ROOT_WINDOW_ID,
      title: deriveTitle(lang, code),
      status: "open",
      createdAt: Date.now(),
      history: [record],
      state: { historyViewport: DEFAULT_HISTORY_VIEWPORT },
    };
    return { ok: true, window };
  },
};

// interpreter_process 类的单处声明：executable（methods + constructor）+ readable + window method。
builtinRegistry.registerWindowClass({
  type: "interpreter_process",
  parentClass: null,
  methods: {
    exec: execMethod,
    close: closeMethod,
    run: runConstructor,
  },
  readable: renderProcessHistory,
  windowMethods: {
    set_history_window: makeSetHistoryWindowMethod("interpreter_process.set_history_window"),
  },
  renderableVisible: true,
  builtinReadable: true,
});
