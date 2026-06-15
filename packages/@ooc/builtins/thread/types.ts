/**
 * thread —— object data 结构（types.ts = 纯 Data）。
 *
 * thread 是 agent 一次智能运行的载体（设计权威：thinkable `knowledge/thread.md`）。它承载这次运行的
 * **过程数据**（context / inbox / outbox / events / status / identity），这些落盘在 thread.json /
 * thread-context.json，由 runtime 管理，**不**冗余进本 class 的业务 Data。
 *
 * thread 经 class 链继承 talk（`ooc.class: "talk"`）的全部会话行为——会话窗与渲染都来自 talk，
 * 故 thread 自身的业务 Data 为空：它的「自我」全在过程数据（runtime/persistence）里，不在 Data 字段。
 */
export interface Data {}

/**
 * @deprecated 过渡别名 —— 旧 `ThreadWindow`（talk 同形 self-view 窗）的窗信封视图。
 * 新契约里 Data 与窗信封（id/class/title/status/createdAt/parentWindowId）分离；前端/旧引用
 * 仍以「窗」整体看待 thread 投影，故保留此交叉类型让其继续编译。Wave4 talk 迁移后归并删除。
 */
export type ThreadWindow = Data & {
  id?: string;
  class?: "thread";
  title?: string;
  status?: string;
  createdAt?: number;
  parentWindowId?: string;
  [key: string]: unknown;
};
