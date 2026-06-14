import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";
import type { ProcessExecRecord } from "@ooc/builtins/_shared/executable/process-record.js";
import type { TranscriptViewport } from "@ooc/core/extendable/_shared/transcript-viewport.js";

export type { ProcessExecRecord } from "@ooc/builtins/_shared/executable/process-record.js";

/**
 * interpreter_process — ts/js 解释进程窗。
 *
 * 由 interpreter 对象构造（args: code, language: ts/js）。每次 exec 跑一段 ts/js 脚本
 * （独立 sandbox），结果作为一条 ProcessExecRecord 追加进 history。ts/js sandbox 通过
 * self.getThreadLocal/setThreadLocal 跨 exec 共享数据。非单例。
 * 注册的 method：exec / close / set_history_window。
 */
export interface InterpreterProcessWindow extends BaseContextWindow {
  class: "interpreter_process";
  status: "open" | "closed";
  history: ProcessExecRecord[];
  /** history 渲染视口；由 window method set_history_window 调整（默认 { tail: 10 }）。 */
  historyViewport?: TranscriptViewport;
}
