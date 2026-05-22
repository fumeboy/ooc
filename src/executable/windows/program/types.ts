import type { BaseContextWindow } from "../_shared/types.js";

/**
 * Program window — REPL 风格的代码执行窗口。
 *
 * - history：每次 exec 一条记录；每次都是独立 sandbox（spec § program_window）
 * - ts/js sandbox 通过 self.getThreadLocal/setThreadLocal 跨 exec 共享数据（落到 thread.threadLocalData）
 * - 注册 command：exec / close
 */
export interface ProgramWindow extends BaseContextWindow {
  type: "program";
  status: "open" | "closed";
  history: ProgramExecRecord[];
}

export interface ProgramExecRecord {
  execId: string;
  language: "shell" | "ts" | "js" | "callCommand";
  code?: string;
  /** plan D4：callCommand 模式 */
  window_id?: string;
  command?: string;
  args?: unknown;
  output: string;
  ok: boolean;
  startedAt: number;
}
