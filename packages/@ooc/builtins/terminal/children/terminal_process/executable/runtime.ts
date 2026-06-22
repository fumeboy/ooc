/**
 * terminal_process 的运行时 —— runBashExec。
 *
 * 由 terminal（构造首 exec）与 terminal_process.exec（追加 exec）共用：跑一段 bash 脚本，
 * 把输出包成 ProcessExecRecord。
 */
import type { ThreadPersistenceRef } from "@ooc/core/_shared/types/thread.js";
import type { ProcessExecRecord } from "../types.js";
import { generateExecId, isOkResult } from "./exec-record.js";
import { runBashScript, buildBashEnv } from "./shell.js";

/** 执行一次 bash exec，返回 ProcessExecRecord。 */
export async function runBashExec(persistence: ThreadPersistenceRef | undefined, code: string | undefined): Promise<ProcessExecRecord> {
  const execId = generateExecId();
  const startedAt = Date.now();
  if (typeof code !== "string" || code.trim() === "") {
    return { execId, language: "shell", code, output: "[terminal_process] 缺少 code 参数", ok: false, startedAt };
  }
  const output = await runBashScript(code, await buildBashEnv(persistence));
  return { execId, language: "shell", code, output, ok: isOkResult(output), startedAt };
}
