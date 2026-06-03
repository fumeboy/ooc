/**
 * @deprecated (M1 2026-06-02) 直接使用的位置请逐步迁移到
 *   `import { createSerialQueue, SerialQueue } from "@ooc/core/runtime/serial-queue"`
 *   或通过 `WorldRuntime.serialQueue` 访问 per-world 实例。
 *
 * 本文件保留 module-level wrapper 函数以保证零调用点修改；所有逻辑已委托到
 * packages/@ooc/core/runtime/serial-queue.ts 的 SerialQueue 类。
 */
import {
  createSerialQueue,
  defaultSerialQueue,
  SerialQueue,
} from "../runtime/serial-queue.js";

export type { SerialQueue };
export { createSerialQueue };

/**
 * 把 `task` 排到 key 对应的队尾, 串行执行后返回其结果。
 *
 * - 不同 key 的 task 并发跑; 相同 key 的 task 严格按入队顺序串行
 * - task 抛错只影响该 caller 的 promise; 后续同 key task 仍能跑
 */
export function enqueueSessionWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  return defaultSerialQueue.enqueue(key, task);
}

/** 测试用: 清空所有队列状态。 */
export function __resetSerialQueueForTests(): void {
  defaultSerialQueue.reset();
}
