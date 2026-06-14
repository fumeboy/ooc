/**
 * terminal_process 的运行时 —— runBashExec。
 *
 * 由 terminal（构造首 exec）与 terminal_process.exec（追加 exec）共用：跑一段 bash 脚本，
 * 把输出包成 ProcessExecRecord。
 */
import type { ThreadContext } from "@ooc/core/thinkable/context.js";
import {
  type ProcessExecRecord,
  generateExecId,
  isOkResult,
} from "@ooc/builtins/_shared/executable/process-record.js";
import { runBashScript, buildBashEnv } from "./shell.js";

/** 执行一次 bash exec，返回 ProcessExecRecord。 */
export async function runBashExec(thread: ThreadContext, code: string | undefined): Promise<ProcessExecRecord> {
  const execId = generateExecId();
  const startedAt = Date.now();
  if (typeof code !== "string" || code.trim() === "") {
    return { execId, language: "shell", code, output: "[terminal_process] 缺少 code 参数", ok: false, startedAt };
  }
  const output = await runBashScript(code, await buildBashEnv(thread.persistence));
  return { execId, language: "shell", code, output, ok: isOkResult(output), startedAt };
}
