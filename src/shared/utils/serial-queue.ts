/**
 * SerialQueue —— 通用 per-key 串行化队列
 *
 * 在同一个 key 下，保证 enqueue 的异步任务按 FIFO 顺序逐个执行；
 * 不同 key 之间互不阻塞。用 Promise 链实现，语义与旧
 * `WriteQueue` / `user-inbox.ts` 的 `_writeChains` / `world/super.ts` 的
 * super 目录锁完全一致，但抽成了统一工具。
 *
 * 设计特性：
 * - **错误隔离**：某个任务 reject 不污染同 key 后续任务；也不影响其他 key
 * - **返回值透传**：`enqueue` 的返回 Promise 解析为 fn 的返回值（泛型保留）
 * - **时序等价于旧 WriteQueue**：失败路径下 throw 先传播（外部 .catch 先执行），
 *   再放行下一个任务，保证观察到的顺序与调用者的异常处理链一致
 * - **自然 GC**：内部只维护当前链尾，旧任务 resolve 后即可被垃圾回收
 *
 * 为什么不直接用锁库：Kernel 要求最小依赖，Promise 链在 30 行内可自给自足。
 *
 * @ref docs/工程管理/迭代/all/20260421_refactor_write_queue统一.md
 * @ref kernel/src/thread/queue.ts — references — WriteQueue 使用 SerialQueue 作为内部实现
 * @ref kernel/src/storable/inbox/user-inbox.ts — references — user inbox 写入也走 SerialQueue
 * @ref kernel/src/world/super.ts — references — SuperFlow 目录锁基于 SerialQueue
 */

/**
 * 按 key 串行化异步任务
 *
 * 同一个 key 的多个 enqueue 调用会被按顺序执行，前一个 await 完毕（无论成败）后
 * 才开始下一个；不同 key 互不影响，可以并发执行。
 *
 * @typeParam K - key 的类型，默认 string；通常是 sessionId / stoneDir 等标识
 */
export class SerialQueue<K = string> {
  /**
   * key → 当前链尾 Promise（总是经过 .catch(() => {}) 包装以吞异常，避免污染后续等待者）
   */
  private _chains = new Map<K, Promise<void>>();

  /**
   * 将一个异步任务排入 key 对应的队列
   *
   * @param key - 串行化键（同 key 串行，不同 key 并行）
   * @param fn - 异步任务
   * @returns 任务完成的 Promise（fn 的返回值会透传；fn 抛错时本 Promise reject，
   *          但同 key 后续 enqueue 的任务仍能正常执行）
   */
  async enqueue<T>(key: K, fn: () => Promise<T>): Promise<T> {
    const prev = this._chains.get(key) ?? Promise.resolve();

    let resolveNext!: () => void;
    let rejectNext!: (err: unknown) => void;
    const next = new Promise<void>((res, rej) => {
      resolveNext = res;
      rejectNext = rej;
    });

    /* 链尾替换为 next.catch(swallow) —— 后续 await prev 看到的是 resolved 的包装 Promise，
     * 无论 next resolve 还是 reject 都不会污染下一个任务。
     *
     * 注意：map 存的是 swallowed 版本而不是 next 本身。这样 fn 抛错时 reject(next) 只
     * 影响本次 enqueue 的返回 Promise，不影响下一个 enqueue 的 await prev。 */
    this._chains.set(key, next.catch(() => {}));

    /* 等待上一个任务完成（prev 已经是 swallowed 版本，不会 reject） */
    await prev;

    try {
      const result = await fn();
      resolveNext();
      /* 链尾 GC：若当前 map 中仍是我们的包装（没有新任务排进来），清理 */
      if (this._chains.get(key) === prev) {
        /* prev 变量指向上一任务的包装——这里不删 */
      }
      return result;
    } catch (err) {
      rejectNext(err);
      throw err;
    }
  }
}
