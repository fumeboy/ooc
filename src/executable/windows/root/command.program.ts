/**
 * root.program command — 创建一个 program_window 并立即执行第一次 exec。
 *
 * - submit 副作用：在 thread.contextWindows 下挂 type=program 的 window；
 *   args 中的 language+code 作为首次 exec 立即跑，结果进 history[0]
 * - 后续 exec：通过 program_window 上注册的 \`exec\` command（windows/program/index.ts）
 * - 跨 exec 共享数据通道：仅 ts/js sandbox 可读写 thread.threadLocalData
 *
 * args 含完整 language+code 时，exec(command="program") 立即执行。
 *
 * 历史：旧 program 还支持 callCommand / function 模式（window_id+command 调命令），
 * 顶层 exec tool 上线后此模式已下线（plan exec-refactor）；要调命令直接用顶层 exec tool。
 */

import type {
  CommandExecutionContext,
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "../_shared/command-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type ProgramWindow,
} from "../_shared/types.js";
import { runOneExec, type ProgramExecArgs } from "../program/runtime.js";

const PROGRAM_BASIC_PATH = "internal/executable/program/basic";
const PROGRAM_INPUT_PATH = "internal/executable/program/input";
const PROGRAM_FORM_STATUS_PATH = "internal/executable/program/form-status";

const KNOWLEDGE = `
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
- self.dir / self.callCommand(windowId, command, args?) / self.getData / self.setData 可用
- 跨 exec 共享：self.getThreadLocal(key) / self.setThreadLocal(key, value)
- shell 之间不共享 threadLocal（OS 进程隔离），需要时自行写入 stone data

后续多次执行：
- exec(window_id="<program_window_id>", command="exec", args={ language, code })

调用示例：
exec(command="program", title="统计 ts 文件数量", args={ language: "shell", code: "find src -name '*.ts' | wc -l" })

要调任意 window 上的命令请直接用顶层 \`exec\` tool（不再走 program）；
ts/js sandbox 内仍可 \`await self.callCommand("custom:<self>", "<name>", {...})\` 编排多步调用。

## 建议

- 修改已有文件优先使用 \`file_window.edit\`（在已 open 的 file_window 上做 oldString→newString 精确替换；支持 atomic 多点修改）
- 新建文件优先使用 \`root.write_file\`（一步写盘 + 自动 spawn file_window）
- 搜索文件名优先使用 \`root.glob\`；搜索文件内容优先使用 \`root.grep\`（结果是结构化 search_window，可被 open_match 直接打开）
- \`program(language="shell")\` 适合临时计算 / 不修改 worktree 的探查（统计、查询版本、跑测试）；**不要用 shell sed / awk / cat-redirect 改文件**——会失去 file_window 的版本可见性，且转义容易出错
`.trim();

export enum ProgramCommandPath {
  Program = "program",
  Shell = "program.shell",
  TypeScript = "program.typescript",
  JavaScript = "program.javascript",
}

export const programCommand: CommandTableEntry = {
  paths: [
    ProgramCommandPath.Program,
    ProgramCommandPath.Shell,
    ProgramCommandPath.TypeScript,
    ProgramCommandPath.JavaScript,
  ],
  match: (args) => {
    const hit: string[] = [ProgramCommandPath.Program];
    const lang = (args.language ?? args.lang) as string | undefined;
    if (lang === "shell") hit.push(ProgramCommandPath.Shell);
    if (lang === "ts" || lang === "typescript") hit.push(ProgramCommandPath.TypeScript);
    if (lang === "js" || lang === "javascript") hit.push(ProgramCommandPath.JavaScript);
    return hit;
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [PROGRAM_BASIC_PATH]: KNOWLEDGE };
    const lang = (args.language ?? args.lang) as string | undefined;
    const code = typeof args.code === "string" ? args.code.trim() : "";

    if (formStatus === "executing") {
      entries[PROGRAM_FORM_STATUS_PATH] = "对于 command program 的 executing 状态的 form，应等待 result 写入后再继续，不要再次 refine 或 submit。";
      return entries;
    }
    if (formStatus === "executed") {
      entries[PROGRAM_FORM_STATUS_PATH] = "对于 command program 的 executed 状态的 form，应先阅读 result；如果结果已经消费，使用 close(form_id, reason=...) 释放 form。";
      return entries;
    }

    if (lang && code) {
      entries[PROGRAM_INPUT_PATH] = "program 参数已具备；submit 即创建 program_window 并执行。";
      return entries;
    }

    entries[PROGRAM_INPUT_PATH] = "program form 缺少可执行参数；refine(args={ language: \"shell\" | \"ts\" | \"js\", code: \"...\" })，再 submit。";
    return entries;
  },
  exec: (ctx) => executeProgramCommand(ctx),
};

/** 截断 title。 */
function deriveTitle(args: ProgramExecArgs, max = 60): string {
  const summary =
    args.language && args.code
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
  };
  if (!(execArgs.language && execArgs.code)) {
    return "[program] 缺少执行参数；需要 language+code。";
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
