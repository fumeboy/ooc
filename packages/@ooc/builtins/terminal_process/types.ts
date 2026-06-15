import type { ProcessExecRecord } from "@ooc/builtins/_shared/executable/process-record.js";

export type { ProcessExecRecord } from "@ooc/builtins/_shared/executable/process-record.js";

/**
 * terminal_process — bash 进程窗的 **object data**（types.ts = 纯 Data）。
 *
 * 由 terminal 对象构造（args: code）。每次 exec 跑一段 bash 脚本（独立子进程），结果作为
 * 一条 ProcessExecRecord 追加进 history。非单例：一个 world 可有多个 terminal_process。
 *
 * 只含业务字段；**不含**窗信封（id/class/title/status/createdAt）——那些由 runtime 管理。
 * history 渲染视口也不在此——归 readable 的投影态 `ProcessWin`（见 _shared/process-readable）。
 */
export interface Data {
  history: ProcessExecRecord[];
}

/**
 * @deprecated 过渡兼容别名 —— visible/ 前端组件仍按旧窗类型签名引用 `TerminalProcessWindow`。
 * 实际只用到 `history` 字段（见 _shared/visible/process-detail 的 ProcessWindowLike）。
 * 待前端切到 OocObjectInstance 投影后删除。
 */
export type TerminalProcessWindow = Data & {
  class?: "terminal_process";
};
