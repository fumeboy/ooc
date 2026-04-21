/**
 * 串行化写入队列（ThreadsTree 专用 facade）
 *
 * 保证对 threads.json 的并发写入操作按 FIFO 顺序串行执行。
 * 每个 Object 的 ThreadsTree 持有一个 WriteQueue 实例。
 *
 * 内部委托给通用的 `SerialQueue`（`src/utils/serial-queue.ts`），对调用方保持
 * 原 API（`enqueue(fn)`，不需要 key），避免改动所有调用点。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#10.2
 * @ref kernel/src/utils/serial-queue.ts — references — 通用 SerialQueue 实现
 */

import { SerialQueue } from "../utils/serial-queue.js";

/**
 * 单实例级串行化队列——每个 ThreadsTree 用一个，所有 enqueue 共用一条链。
 *
 * 我们复用通用 `SerialQueue`，用常量 key（整个实例就一条链）。
 */
export class WriteQueue {
  /** 单 key 的通用串行化队列 */
  private _inner = new SerialQueue<symbol>();
  private _key = Symbol("WriteQueue");

  /**
   * 将写入操作加入队列，等待前序操作完成后执行
   *
   * 直接返回内部 enqueue 的 Promise，不加 async 封装——避免额外 await 层改变失败路径
   * 上 `.catch` 回调和下一任务的微任务调度顺序（ThreadsTree 的调用方依赖这个时序）。
   *
   * @param fn - 异步写入操作
   * @returns 操作完成的 Promise
   */
  enqueue(fn: () => Promise<void>): Promise<void> {
    return this._inner.enqueue(this._key, fn);
  }
}
