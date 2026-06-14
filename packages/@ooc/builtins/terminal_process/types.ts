import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";
import type { ProcessExecRecord } from "@ooc/builtins/_shared/executable/process-record.js";
import type { TranscriptViewport } from "@ooc/core/extendable/_shared/transcript-viewport.js";

export type { ProcessExecRecord } from "@ooc/builtins/_shared/executable/process-record.js";

/**
 * terminal_process — bash 进程窗。
 *
 * 由 terminal 对象构造（args: code）。每次 exec 跑一段 bash 脚本（独立子进程），结果作为
 * 一条 ProcessExecRecord 追加进 history。非单例：一个 world 可有多个 terminal_process。
 * 注册的 method：exec / close / set_history_window。
 */
export interface TerminalProcessWindow extends BaseContextWindow {
  class: "terminal_process";
  status: "open" | "closed";
  history: ProcessExecRecord[];
  /** history 渲染视口；由 window method set_history_window 调整（默认 { tail: 10 }）。 */
  historyViewport?: TranscriptViewport;
}
