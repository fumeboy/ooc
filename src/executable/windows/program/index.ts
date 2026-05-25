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
} from "../_shared/command-types.js";
import { registerWindowType, type RenderContext } from "../_shared/registry.js";
import { runOneExec, type ProgramExecArgs } from "./runtime.js";
import type { ProgramWindow } from "../_shared/types.js";
import { xmlElement, xmlText, xmlComment, truncateBytes, type XmlNode } from "../../../thinkable/context/xml.js";

const PROGRAM_WINDOW_EXEC_BASIC = "internal/windows/program/exec/basic";
const PROGRAM_WINDOW_EXEC_INPUT = "internal/windows/program/exec/input";
const PROGRAM_WINDOW_CLOSE_BASIC = "internal/windows/program/close/basic";

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
`.trim();

const CLOSE_KNOWLEDGE = `
program_window.close 等价于 close tool；释放 window 与 history。
不会停止任何外部进程（每次 exec 都已经结束）。
`.trim();

const execCommand: CommandTableEntry = {
  paths: ["exec", "exec.shell", "exec.ts", "exec.js"],
  // Q0d: program_window.exec 等价于 root.program 的二次执行; design §3 ask。
  permission: "ask",
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

/** program_window 的 renderXml hook：history 摘要 + 最近一条 full output。 */
function renderProgramWindow(ctx: RenderContext): XmlNode[] {
  const window = ctx.window as ProgramWindow;
  const children: XmlNode[] = [];
  if (window.history.length === 0) {
    children.push(xmlComment("(no exec yet)"));
    return children;
  }
  const summary = window.history.map((rec, idx) =>
    xmlElement(
      "exec",
      { id: rec.execId, n: String(idx), kind: rec.language, ok: rec.ok ? "ok" : "fail" },
      [],
    ),
  );
  children.push(xmlElement("history", {}, summary));

  const last = window.history[window.history.length - 1]!;
  children.push(
    xmlElement(
      "last_output",
      { exec_id: last.execId },
      [xmlText(truncateBytes(last.output))],
    ),
  );
  return children;
}

registerWindowType("program", {
  commands: {
    exec: execCommand,
    close: closeCommand,
  },
  renderXml: renderProgramWindow,
});
