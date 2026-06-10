/**
 * program_window 的运行时 — runOneExec。
 *
 * 由 root.program 与 program_window.exec 共用：根据 args 路由到 shell / ts / js，
 * 把每次执行的输出包装成 ProgramExecRecord 追加到对应 window 的 history。
 *
 * 依赖边界（object method 的执行环境是 session 工作区，不与 thread 绑定）：
 * - shell 路径：只依赖 `thread.persistence`（FlowObjectRef，session 级）——
 *   经 buildProgramShellEnv 透出 OOC_SELF_DIR，不接 threadLocal 通道。
 * - ts/js 路径：getData/setData 同样走 session 级 data.json；但 ProgramSelf 的
 *   `callMethod`（查当前线程可见 windows）与 `getThreadLocal/setThreadLocal`
 *   （线程内跨 exec 传值）语义上属于**调用现场**，是仅有的两个真 thread 依赖。
 *
 * 历史：旧版本支持 callMethod / function 子模式，调任意 window 上的命令。
 * 顶层 `exec` tool 上线后（plan exec-refactor），LLM 直接用 exec 调命令；
 * program 只剩 shell/ts/js 三种语言模式。ts/js sandbox 的 `self.callMethod`
 * 仍保留，供脚本编排时多步调命令。
 */

import type { ThreadContext } from "@ooc/core/thinkable/context.js";
import type { ProgramExecRecord } from "@ooc/core/extendable/_shared/types.js";
import { createProgramSelf } from "./self.js";
import { deriveStoneFromThread } from "@ooc/core/persistable/index.js";
import { executeUserCode } from "./sandbox/executor.js";
import { runShellProgram } from "./shell.js";
import { buildProgramShellEnv } from "./self-env.js";
import { formatProgramResult } from "./format.js";

/** 一次 exec 调用的入参形态。 */
export interface ProgramExecArgs {
  language?: "shell" | "ts" | "typescript" | "js" | "javascript";
  code?: string;
}

function generateExecId(): string {
  return `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** result 字符串里包含失败标记时视为 ok=false。 */
function isOkResult(result: string): boolean {
  const head = result.slice(0, 256);
  return !(
    head.startsWith("[program-error]") ||
    head.startsWith("[program") || // shell/ts/js missing-arg etc.
    head.includes("缺少") ||
    head.includes("失败") ||
    head.includes("不存在") ||
    head.includes("不在") ||
    head.includes("[error]")
  );
}

/** 执行一次 exec，返回 ProgramExecRecord。 */
export async function runOneExec(
  thread: ThreadContext,
  args: ProgramExecArgs,
): Promise<ProgramExecRecord> {
  const execId = generateExecId();
  const startedAt = Date.now();

  const lang = args.language;
  const code = args.code;

  if (lang === "shell") {
    if (typeof code !== "string" || code.trim() === "") {
      const output = `[program.shell] 缺少 code 参数`;
      return { execId, language: "shell", code, output, ok: false, startedAt };
    }
    const output = await runShellProgram(code, await buildProgramShellEnv(thread.persistence));
    return { execId, language: "shell", code, output, ok: isOkResult(output), startedAt };
  }

  if (lang === "ts" || lang === "typescript" || lang === "js" || lang === "javascript") {
    if (typeof code !== "string" || code.trim() === "") {
      const output = `[program.${lang}] 缺少 code 参数`;
      const normLang = lang === "ts" || lang === "typescript" ? "ts" : "js";
      return { execId, language: normLang, code, output, ok: false, startedAt };
    }
    const output = await runTsJs(thread, code);
    const normLang = lang === "ts" || lang === "typescript" ? "ts" : "js";
    return { execId, language: normLang, code, output, ok: isOkResult(output), startedAt };
  }

  const output = `[program] 未知 language="${lang ?? "<undefined>"}"，支持 shell / ts / js`;
  return { execId, language: "shell", code, output, ok: false, startedAt };
}

async function runTsJs(thread: ThreadContext, code: string): Promise<string> {
  const persistence = thread.persistence;
  // ts/js 在无 persistence 时也允许跑（能调用 console，但 self.* 全空）
  const self = persistence ? createProgramSelf(deriveStoneFromThread(persistence), thread) : null;
  const exec = await executeUserCode(code, self);
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  return formatProgramResult(`# ts/js: ${firstLine}`, exec.stdout, exec.returnValue, exec.error);
}
