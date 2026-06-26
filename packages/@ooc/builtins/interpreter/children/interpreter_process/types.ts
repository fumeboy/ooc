/**
 * interpreter_process — ts/js 解释进程 class 的 **object data**（types.ts = 纯 Data）。
 *
 * 由 interpreter 对象构造（args: code, language: ts/js）。每次 exec 跑一段 ts/js 脚本
 * （独立 sandbox），结果作为一条 ProcessExecRecord 追加进 history。ts/js sandbox 通过注入的
 * self-proxy（`self.data.userData`）读写本实例自身的持久 scratch（随默认 data.json 持久化、
 * 跨 exec/reload 存活）。非单例。
 *
 * 业务字段：history（exec 记录）+ userData（用户脚本经 self.data.userData 读写的持久 scratch，
 * 与 history 投影隔离）。**不含**窗的元信息（id/class/title/status/createdAt）——由 runtime 管理；
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

/** interpreter_process 的业务数据：历次 ts/js exec 记录 + 用户脚本的持久 scratch。 */
export interface Data {
  history: ProcessExecRecord[];
  /** sandbox 经 self.data.userData 读写的用户持久 scratch（与 history 投影隔离）；随默认 data.json 落盘。 */
  userData?: Record<string, unknown>;
}

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * 本 class 全部字段非版本化（运行时载体 / tool-object / sediment 已落 pool）。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = [] as const;
