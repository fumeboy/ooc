/**
 * 串行化写入队列
 *
 * 保证对 threads.json 的并发写入操作按 FIFO 顺序串行执行。
 * 每个 Object 的 ThreadsTree 持有一个 WriteQueue 实例。
 *
 * 实现原理：维护一个 Promise 链，每次 enqueue 将新操作追加到链尾。
 * 与 Session.serializedWrite 原理相同，但独立于 Session 生命周期。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#10.2
 */

export class WriteQueue {
  /** Promise 链尾部 */
  private _tail: Promise<void> = Promise.resolve();

  /**
   * 将写入操作加入队列，等待前序操作完成后执行
   *
   * @param fn - 异步写入操作
   * @returns 操作完成的 Promise
   */
  async enqueue(fn: () => Promise<void>): Promise<void> {
    const prev = this._tail;
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const next = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this._tail = next.catch(() => {});
    await prev.catch(() => {});
    try {
      await fn();
      resolve();
    } catch (err) {
      reject(err);
      throw err;
    }
  }
}
