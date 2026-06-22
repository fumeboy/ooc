/**
 * interpreter_process 的运行时 —— runInterpreterExec。
 *
 * 由 interpreter（构造首 exec）与 interpreter_process.exec（追加 exec）共用：跑一段 ts/js
 * 脚本（独立 sandbox），把输出包成 ProcessExecRecord。
 */
import type { ThreadPersistenceRef } from "@ooc/core/_shared/types/thread.js";
import type { RuntimeHandle } from "@ooc/core/executable/contract.js";
import { deriveStoneFromThread } from "@ooc/core/persistable/index.js";
import type { ProcessExecRecord } from "../types.js";
import { generateExecId, isOkResult, formatInterpreterResult } from "./exec-record.js";
import { createInterpreterSelf } from "./self.js";
import { executeUserCode } from "./sandbox/executor.js";

export type InterpreterLang = "ts" | "typescript" | "js" | "javascript";

/**
 * 执行一次 ts/js exec，返回 ProcessExecRecord。
 *
 * `runtime`（RuntimeHandle，由 method/constructor 的 ctx 传入）让 sandbox 内的 self.callMethod
 * 经 runtime 跨窗调用别的对象的 object method；缺席时 self.callMethod 抛清晰错误。
 *
 * `userData`：本 process 实例自身 data 的 `userData` 子字段（活引用）——self.getData/setData
 * 直接读写它（隔离 history 投影）；construct/exec 两入口各自把实例的 userData 串进来。
 * `reportDataEdit`：setData 写后通知 runtime 重持久化（construct 阶段可缺省，写入随返回 Data 落盘）。
 */
export async function runInterpreterExec(
  persistence: ThreadPersistenceRef | undefined,
  language: InterpreterLang | undefined,
  code: string | undefined,
  userData: Record<string, unknown>,
  runtime?: RuntimeHandle,
  reportDataEdit?: () => Promise<void>,
): Promise<ProcessExecRecord> {
  const execId = generateExecId();
  const startedAt = Date.now();
  const normLang: "ts" | "js" = language === "js" || language === "javascript" ? "js" : "ts";
  if (typeof code !== "string" || code.trim() === "") {
    return { execId, language: normLang, code, output: `[interpreter_process] 缺少 code 参数`, ok: false, startedAt };
  }
  const output = await runTsJs(persistence, code, userData, runtime, reportDataEdit);
  return { execId, language: normLang, code, output, ok: isOkResult(output), startedAt };
}

async function runTsJs(
  persistence: ThreadPersistenceRef | undefined,
  code: string,
  userData: Record<string, unknown>,
  runtime?: RuntimeHandle,
  reportDataEdit?: () => Promise<void>,
): Promise<string> {
  // ts/js 在无 persistence 时也允许跑（能调用 console，但 self.* 全空）
  const self = persistence
    ? createInterpreterSelf(deriveStoneFromThread(persistence), userData, runtime, reportDataEdit)
    : null;
  const exec = await executeUserCode(code, self);
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  return formatInterpreterResult(`# ts/js: ${firstLine}`, exec.stdout, exec.returnValue, exec.error);
}
