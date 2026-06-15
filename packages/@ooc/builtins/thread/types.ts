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
