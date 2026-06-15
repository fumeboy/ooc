/**
 * interpreter_process 的运行时 —— runInterpreterExec。
 *
 * 由 interpreter（构造首 exec）与 interpreter_process.exec（追加 exec）共用：跑一段 ts/js
 * 脚本（独立 sandbox），把输出包成 ProcessExecRecord。
 */
import type { ThreadContext } from "@ooc/core/thinkable/context.js";
import type { RuntimeHandle } from "@ooc/core/executable/contract.js";
import { deriveStoneFromThread } from "@ooc/core/persistable/index.js";
import {
  type ProcessExecRecord,
  generateExecId,
  isOkResult,
  formatInterpreterResult,
} from "@ooc/builtins/_shared/executable/process-record.js";
import { createInterpreterSelf } from "./self.js";
import { executeUserCode } from "./sandbox/executor.js";

export type InterpreterLang = "ts" | "typescript" | "js" | "javascript";

/**
 * 执行一次 ts/js exec，返回 ProcessExecRecord。
 *
 * `runtime`（RuntimeHandle，由 method/constructor 的 ctx 传入）让 sandbox 内的 self.callMethod
 * 经 runtime 跨窗调用别的对象的 object method；缺席时 self.callMethod 抛清晰错误。
 */
export async function runInterpreterExec(
  thread: ThreadContext,
  language: InterpreterLang | undefined,
  code: string | undefined,
  runtime?: RuntimeHandle,
): Promise<ProcessExecRecord> {
  const execId = generateExecId();
  const startedAt = Date.now();
  const normLang: "ts" | "js" = language === "js" || language === "javascript" ? "js" : "ts";
  if (typeof code !== "string" || code.trim() === "") {
    return { execId, language: normLang, code, output: `[interpreter_process] 缺少 code 参数`, ok: false, startedAt };
  }
  const output = await runTsJs(thread, code, runtime);
  return { execId, language: normLang, code, output, ok: isOkResult(output), startedAt };
}

async function runTsJs(thread: ThreadContext, code: string, runtime?: RuntimeHandle): Promise<string> {
  const persistence = thread.persistence;
  // ts/js 在无 persistence 时也允许跑（能调用 console，但 self.* 全空）
  const self = persistence ? createInterpreterSelf(deriveStoneFromThread(persistence), thread, runtime) : null;
  const exec = await executeUserCode(code, self);
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  return formatInterpreterResult(`# ts/js: ${firstLine}`, exec.stdout, exec.returnValue, exec.error);
}
