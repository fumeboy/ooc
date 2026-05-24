/**
 * Per-key SerialQueue —— 按 key(常为 sessionId)串行执行 async task。
 *
 * 让多个写入路径(HTTP / LLM 命令 / worker tick)在同 session 内按入队顺序
 * 落盘,避免 `index.json` 等共享文件因并发被踩坏。MVP 单 worker 进程内有效;
 * 多进程部署仍需文件锁(Risk 3,留给 follow-up)。
 */

const tails = new Map<string, Promise<unknown>>();

/**
 * 把 `task` 排到 key 对应的队尾,串行执行后返回其结果。
 *
 * - 不同 key 的 task 并发跑;相同 key 的 task 严格按入队顺序串行
 * - task 抛错只影响该 caller 的 promise;后续同 key task 仍能跑(tail 在 map 里
 *   被替换为 catch 过的 promise 防止毒化)
 * - Map 增长无清理(MVP session 数有上限,内存可接受)
 */
export function enqueueSessionWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  // 不让上游错误污染 chain;但当前 caller 仍然拿到原始 promise(带错)
  const next = prev.then(task, task);
  // intentional: silent-swallow ban 例外——caller 通过 next 已经拿到原始错误，
  // tail 处 .catch(() => undefined) 仅防止 promise rejection 毒化后续同 key 的 task。
  tails.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/** 测试用:清空所有队列状态(各 test 前调一次以避免互相干扰)。 */
export function __resetSerialQueueForTests(): void {
  tails.clear();
}
