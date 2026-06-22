/**
 * interpreter_process 的运行时 —— runInterpreterExec。
 *
 * 由 interpreter（构造首 exec）与 interpreter_process.exec（追加 exec）共用：跑一段 ts/js
 * 脚本（独立 sandbox），把输出包成 ProcessExecRecord。
 *
 * **零 thread/persistence 依赖**：sandbox 注入的 `(self, ctx)` 与标准 object method 同构，由
 * 调用方（exec/construct）从自己的 ctx 直接透传——本模块不再 deriveStoneFromThread、不再自建
 * bespoke self。
 */
import type { ExecutableContext, ConstructorContext } from "@ooc/core/executable/contract.js";
import type { SelfProxy } from "@ooc/core/_shared/types/self-proxy.js";
import type { Data } from "../types.js";
import type { ProcessExecRecord } from "../types.js";
import { generateExecId, isOkResult, formatInterpreterResult } from "./exec-record.js";
import { executeUserCode } from "./sandbox/executor.js";

export type InterpreterLang = "ts" | "typescript" | "js" | "javascript";

/** sandbox 注入的 ctx —— exec 走 ExecutableContext、construct 走 ConstructorContext，皆透传。 */
export type InterpreterExecCtx = ExecutableContext | ConstructorContext;

/**
 * 执行一次 ts/js exec，返回 ProcessExecRecord。
 *
 * `self`（SelfProxy）：sandbox 里 `self.data` 读写本 interpreter_process 实例业务数据
 * （含 `userData` scratch 与 `history`，活引用、随默认 data.json 落盘）、`self.methods.x()` 自调本对象方法。
 * `ctx`：sandbox 里 `ctx.runtime.callMethod(id, method, args)` 跨窗调别的对象（跨窗执行路径归 ExecutableContext）。
 */
export async function runInterpreterExec(
  language: InterpreterLang | undefined,
  code: string | undefined,
  self: SelfProxy<Data>,
  ctx: InterpreterExecCtx,
): Promise<ProcessExecRecord> {
  const execId = generateExecId();
  const startedAt = Date.now();
  const normLang: "ts" | "js" = language === "js" || language === "javascript" ? "js" : "ts";
  if (typeof code !== "string" || code.trim() === "") {
    return { execId, language: normLang, code, output: `[interpreter_process] 缺少 code 参数`, ok: false, startedAt };
  }
  const exec = await executeUserCode(code, self, ctx);
  const firstLine = code.split("\n")[0]?.trim() ?? "";
  const output = formatInterpreterResult(`# ts/js: ${firstLine}`, exec.stdout, exec.returnValue, exec.error);
  return { execId, language: normLang, code, output, ok: isOkResult(output), startedAt };
}
