/**
 * root.program command — 创建一个 program_window 并立即执行第一次 exec。
 *
 * spec § program_window：
 * - submit 副作用：在 thread.contextWindows 下挂 type=program 的 window；
 *   args 中的 language+code / function+args 作为首次 exec 立即跑，结果进 history[0]
 * - 后续 exec：通过 program_window 上注册的 \`exec\` command（windows/program.ts）
 * - 跨 exec 共享数据通道：仅 ts/js sandbox 可读写 thread.threadLocalData
 *
 * C 规则：args 含完整 language+code 或 function+args 时一步触发自动 submit。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "./types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type ProgramWindow,
} from "../windows/types.js";
import { runOneExec, type ProgramExecArgs } from "../windows/program-runtime.js";

const PROGRAM_BASIC_PATH = "internal/executable/program/basic";
const PROGRAM_INPUT_PATH = "internal/executable/program/input";
const PROGRAM_FORM_STATUS_PATH = "internal/executable/program/form-status";

const KNOWLEDGE = `
program 用于执行一段代码或调用 server 方法；submit 后产出一个 program_window，
首次 exec 立即跑完，结果进 program_window.history。后续 exec 通过该 window 的
\`exec\` command 触发。

参数（首次 exec）：
- language: 可选，shell / ts / js（与 code 配合）
- code: 模式 A 待执行代码字符串
- function: 模式 B 目标函数名
- args: 模式 B 函数调用参数对象

shell 环境变量：
- shell 命令的 cwd 是 OOC 进程的工作目录
- 想读写自己的 stone 目录（self.dir），用 env $OOC_SELF_DIR

ts/js 上下文：
- self.dir / self.callMethod / self.getData / self.setData 不变
- 跨 exec 共享：self.getThreadLocal(key) / self.setThreadLocal(key, value)
- shell 之间不共享 threadLocal（OS 进程隔离），需要时自行写入 stone data

后续多次执行：
- open(parent_window_id="<program_window_id>", command="exec", args={ language, code })

调用示例：
open(command="program", title="统计 ts 文件数量", args={ language: "shell", code: "find src -name '*.ts' | wc -l" })
`.trim();

export enum ProgramCommandPath {
  Program = "program",
  Shell = "program.shell",
  TypeScript = "program.typescript",
  JavaScript = "program.javascript",
  Function = "program.function",
}

export const programCommand: CommandTableEntry = {
  paths: [
    ProgramCommandPath.Program,
    ProgramCommandPath.Shell,
    ProgramCommandPath.TypeScript,
    ProgramCommandPath.JavaScript,
    ProgramCommandPath.Function,
  ],
  match: (args) => {
    const hit: string[] = [ProgramCommandPath.Program];
    const lang = (args.language ?? args.lang) as string | undefined;
    if (lang === "shell") hit.push(ProgramCommandPath.Shell);
    if (lang === "ts" || lang === "typescript") hit.push(ProgramCommandPath.TypeScript);
    if (lang === "js" || lang === "javascript") hit.push(ProgramCommandPath.JavaScript);
    if (typeof args.function === "string") hit.push(ProgramCommandPath.Function);
    return hit;
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [PROGRAM_BASIC_PATH]: KNOWLEDGE };
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";
    const fn = typeof args.function === "string" ? args.function : undefined;
    const fnArgs = args.args;

    if (formStatus === "executing") {
      entries[PROGRAM_FORM_STATUS_PATH] = "对于 command program 的 executing 状态的 form，应等待 result 写入后再继续，不要再次 refine 或 submit。";
      return entries;
    }
    if (formStatus === "executed") {
      entries[PROGRAM_FORM_STATUS_PATH] = "对于 command program 的 executed 状态的 form，应先阅读 result；如果结果已经消费，使用 close(form_id, reason=...) 释放 form。";
      return entries;
    }

    if (fn) {
      if (fnArgs && typeof fnArgs === "object" && !Array.isArray(fnArgs)) {
        entries[PROGRAM_INPUT_PATH] = "program.function 参数已具备；submit 即创建 program_window 并执行。";
      } else {
        entries[PROGRAM_INPUT_PATH] = "program.function 缺少 args 对象；先用 refine(args={ function: \"name\", args: {...} })，再 submit。";
      }
      return entries;
    }

    if (lang && code) {
      entries[PROGRAM_INPUT_PATH] = "program shell/ts/js 参数已具备；submit 即创建 program_window 并执行。";
      return entries;
    }

    entries[PROGRAM_INPUT_PATH] = "program form 缺少可执行参数；refine(args={ language: \"shell\" | \"ts\" | \"js\", code: \"...\" }) 或 refine(args={ function: \"name\", args: {...} })，再 submit。";
    return entries;
  },
  exec: (ctx) => executeProgramCommand(ctx),
};

/** 截断 title。 */
function deriveTitle(args: ProgramExecArgs, max = 60): string {
  const summary =
    args.function !== undefined
      ? `fn:${args.function}`
      : args.language && args.code
        ? `${args.language}: ${args.code.split("\n")[0] ?? ""}`
        : "program";
  return summary.length <= max ? summary : `${summary.slice(0, max)}...`;
}

/**
 * root.program 执行入口：创建 program_window + 跑首次 exec。
 *
 * 失败时返回字符串 → WindowManager 把 form 留在 executed 状态。成功时副作用挂载完毕，返回 undefined。
 */
export async function executeProgramCommand(
  ctx: CommandExecutionContext,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return undefined;

  // 首次 exec 的 args 即来自 form
  const execArgs: ProgramExecArgs = {
    language: ctx.args.language as ProgramExecArgs["language"],
    code: ctx.args.code as string | undefined,
    function: ctx.args.function as string | undefined,
    args: ctx.args.args as Record<string, unknown> | undefined,
  };
  // 验证至少有一种执行模式
  if (!execArgs.function && !(execArgs.language && execArgs.code)) {
    return "[program] 缺少执行参数；需要 language+code 或 function+args。";
  }

  const record = await runOneExec(thread, execArgs);
  const programWindow: ProgramWindow = {
    id: generateWindowId("program"),
    type: "program",
    parentWindowId: ROOT_WINDOW_ID,
    title: deriveTitle(execArgs),
    status: "open",
    createdAt: Date.now(),
    history: [record],
  };

  if (ctx.manager) {
    ctx.manager.insertTypedWindow(programWindow);
  } else {
    thread.contextWindows = [...(thread.contextWindows ?? []), programWindow];
  }
  return undefined;
}
