/**
 * terminal_process — bash 进程窗的 **object data**（types.ts = 纯 Data）。
 *
 * 由 terminal 对象构造（args: code）。每次 exec 跑一段 bash 脚本（独立子进程），结果作为
 * 一条 ProcessExecRecord 追加进 history。非单例：一个 world 可有多个 terminal_process。
 *
 * 只含业务字段；**不含**窗信封（id/class/title/status/createdAt）——那些由 runtime 管理。
 * history 渲染视口也不在此——归 readable 的投影态 `ProcessWin`（见 readable/history.ts）。
 */

/** 单条 bash 执行记录（terminal_process 自有，与 interpreter_process 各自独立）。 */
export interface ProcessExecRecord {
  execId: string;
  language: "shell";
  code?: string;
  output: string;
  ok: boolean;
  startedAt: number;
}

export interface Data {
  history: ProcessExecRecord[];
}
