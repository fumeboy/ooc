import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";
import type { TranscriptViewport } from "@ooc/core/extendable/_shared/transcript-viewport.js";

/**
 * program_window 的 history 渲染视口（R1c: 复用 TranscriptViewport 的 tail/range 协议）。
 *
 * - 默认 { tail: 10 } —— 仅渲染末 10 次 exec
 * - LLM 通过 set_history_window 命令切换：history_tail / history_start + history_end
 * - 算法复用 _shared/transcript-viewport.ts（applyTranscriptViewport<M>）
 * - 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol
 */
export type HistoryViewport = TranscriptViewport;

/**
 * Program window — REPL 风格的代码执行窗口。
 *
 * - history：每次 exec 一条记录；每次都是独立 sandbox（spec § program_window）
 * - ts/js sandbox 通过 self.getThreadLocal/setThreadLocal 跨 exec 共享数据（落到 thread.threadLocalData）
 * - historyViewport: 默认 { tail: 10 } —— 用 set_history_window 调整可见区间
 * - 注册 command：exec / close / set_history_window
 */
export interface ProgramWindow extends BaseContextWindow {
  type: "program";
  status: "open" | "closed";
  history: ProgramExecRecord[];
  /**
   * history 渲染视口；默认 { tail: 10 }；
   * 通过 set_history_window 切换（语义同 transcript viewport，字段名前缀 history_）。
   * 详见 patches.viewport_protocol。
   */
  historyViewport?: HistoryViewport;
}

export interface ProgramExecRecord {
  execId: string;
  language: "shell" | "ts" | "js" | "function";
  code?: string;
  output: string;
  ok: boolean;
  startedAt: number;
  /** For language="function": the function name */
  function?: string;
  /** For language="function": the function call arguments */
  args?: unknown;
}
