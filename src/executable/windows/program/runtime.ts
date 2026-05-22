/**
 * program_window 的运行时 — runOneExec。
 *
 * 由 root.program 与 program_window.exec 共用：根据 args 路由到 shell / ts / js / function，
 * 把每次执行的输出包装成 ProgramExecRecord 追加到对应 window 的 history。
 *
 * 注意：thread.threadLocalData 的读写发生在 ProgramSelf 内部（src/executable/server/self.ts）；
 * shell sandbox 通过 OOC_SELF_DIR env 访问 stone 目录，不接 threadLocal 通道。
 */

import type { ThreadContext } from "../../../thinkable/context.js";
import type { ProgramExecRecord } from "../_shared/types.js";
import { createProgramSelf } from "../../server/self.js";
import { deriveStoneFromThread } from "../../../persistable/index.js";
import { executeUserCode } from "../../program/sandbox/executor.js";
import { runShellProgram } from "../../program/shell.js";
import { runCallCommandProgram } from "../../program/call-command.js";
import { buildProgramShellEnv } from "../../program/self-env.js";
import { formatProgramResult } from "../../program/format.js";

/** 一次 exec 调用的入参形态（plan §6.3 D4：function 字段被替换为 window_id + command）。 */
export interface ProgramExecArgs {
  language?: "shell" | "ts" | "typescript" | "js" | "javascript";
  code?: string;
  /** plan D4：调任意 window 上任意 command；与 command 配套使用 */
  window_id?: string;
  command?: string;
  args?: Record<string, unknown>;
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

  // callCommand 模式（旧 function 模式的升级版；plan D4）
  if (
    typeof args.window_id === "string" &&
    args.window_id.length > 0 &&
    typeof args.command === "string" &&
    args.command.length > 0
  ) {
    const output = await runCallCommandProgram(thread, args.window_id, args.command, args.args ?? {});
    return {
      execId,
      language: "callCommand",
      window_id: args.window_id,
      command: args.command,
      args: args.args,
      output,
      ok: isOkResult(output),
      startedAt,
    };
  }

  const lang = args.language;
  const code = args.code;

  if (lang === "shell") {
    if (typeof code !== "string" || code.trim() === "") {
      const output = `[program.shell] 缺少 code 参数`;
      return { execId, language: "shell", code, output, ok: false, startedAt };
    }
    const output = await runShellProgram(code, buildProgramShellEnv(thread));
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

  const output = `[program] 未知 language="${lang ?? "<undefined>"}"，支持 shell / ts / js / function`;
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
