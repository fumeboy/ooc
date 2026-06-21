/**
 * interpreter_process — ts/js 解释进程 class 的 **object data**（types.ts = 纯 Data）。
 *
 * 由 interpreter 对象构造（args: code, language: ts/js）。每次 exec 跑一段 ts/js 脚本
 * （独立 sandbox），结果作为一条 ProcessExecRecord 追加进 history。ts/js sandbox 通过
 * self.getThreadLocal/setThreadLocal 跨 exec 共享数据。非单例。
 *
 * 只含业务字段：history。**不含**窗信封（id/class/title/status/createdAt）——由 runtime 管理；
 * 也**不含**展示态（history viewport）——归 readable 的投影态 win（见 readable/history.ts 的 ProcessWin）。
 */

/** 单条 ts/js 执行记录（interpreter_process 自有，与 terminal_process 各自独立）。 */
export interface ProcessExecRecord {
  execId: string;
  language: "ts" | "js";
  code?: string;
  output: string;
  ok: boolean;
  startedAt: number;
}

/** interpreter_process 的业务数据：历次 ts/js exec 记录。 */
export interface Data {
  history: ProcessExecRecord[];
}
