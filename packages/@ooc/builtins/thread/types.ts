import type { BaseContextWindow } from "@ooc/core/extendable/_shared/types.js";

/**
 * ThreadWindow —— thread 对自身的投影窗（self-view）。
 *
 * thread 是 agent 一次智能运行的载体（设计权威见 thinkable `knowledge/thread.md`）：
 * 它持有 context / inbox / outbox / events / status / identity，并跑 thinkloop。
 * 这些**过程数据**落盘在 thread.json / thread-context.json，**不**冗余进本窗——
 * ThreadWindow 只是 thread 把"自己这次运行"投影给持有它的 agent 看的一面镜子：
 * 让 agent 从自身视角看到 "我是哪条 thread、跑到什么状态、从属于谁"。
 *
 * S3.1 立座阶段：thread class 经 registerWindowClass 注册（无 constructor——thread 由
 * agency `talk` 创建，不经 open() 构造），methods 暂空；本窗类型已是合法 ContextWindow，
 * 但尚无代码产出 / 消费它（注入留待后续子步）。字段保持最小、纯投影、可向后扩展。
 */
export interface ThreadWindow extends BaseContextWindow {
  class: "thread";
  /**
   * 窗生命周期 status（沿用 BaseContextWindow 的 WindowStatus，约束到 thread 自视图用到的子集）。
   * 注意：这与 **thread 的运行 status**（running / waiting / done / failed / paused）是两回事——
   * 后者是 thread 的过程数据，落 thread.json，投影到本窗时用下方 `threadStatus`。
   */
  status: "running" | "done" | "failed";
  /** thread 运行状态（投影自 thread.status；自视图展示用，与窗生命周期 status 区分）。 */
  threadStatus: "running" | "waiting" | "done" | "failed" | "paused";
  /** 创建本 thread 的 thread id（它从属于谁 / 向谁负责）；root thread 无。 */
  creatorThreadId?: string;
}
