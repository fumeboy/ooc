import type { ProcessExecRecord } from "../types.js";
import { generateExecId, isOkResult } from "./exec-record.js";
import { runBashScript, buildBashEnv } from "./shell.js";

/** 执行一次 bash exec，返回 ProcessExecRecord。 */
export async function runBashExec(selfDir:string, code: string | undefined): Promise<ProcessExecRecord> {
  const execId = generateExecId();
  const startedAt = Date.now();
  if (typeof code !== "string" || code.trim() === "") {
    return { execId, language: "shell", code, output: "[terminal_process] 缺少 code 参数", ok: false, startedAt };
  }
  const output = await runBashScript(code, await buildBashEnv(selfDir));
  return { execId, language: "shell", code, output, ok: isOkResult(output), startedAt };
}
