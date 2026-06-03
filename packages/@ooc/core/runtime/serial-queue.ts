/**
 * Per-key SerialQueue —— 按 key (常为 sessionId) 串行执行 async task。
 *
 * M1 (2026-06-02): 从 persistable/serial-queue.ts 抽出为可实例化类。
 * 原有 module-level 导出保留，作为对 `defaultQueue` 的 thin wrapper，零调用点修改。
 *
 * 让多个写入路径 (HTTP / LLM 命令 / worker tick) 在同 session 内按入队顺序
 * 落盘, 避免 `index.json` 等共享文件因并发被踩坏。MVP 单 worker 进程内有效;
 * 多进程部署仍需文件锁。
 */
export class SerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  /**
   * 把 `task` 排到 key 对应的队尾, 串行执行后返回其结果。
   *
   * - 不同 key 的 task 并发跑; 相同 key 的 task 严格按入队顺序串行
   * - task 抛错只影响该 caller 的 promise; 后续同 key task 仍能跑 (tail 在 map 里
   *   被替换为 catch 过的 promise 防止毒化)
   */
  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.tails.set(key, next.catch(() => undefined));
    return next;
  }

  /** 清空所有队列状态（测试用）。 */
  reset(): void {
    this.tails.clear();
  }
}

/** module-level 默认实例——所有现有 wrapper 函数委托给它。 */
export const defaultSerialQueue = new SerialQueue();

/** 创建一个全新的独立队列实例（给 WorldRuntime 用）。 */
export function createSerialQueue(): SerialQueue {
  return new SerialQueue();
}
