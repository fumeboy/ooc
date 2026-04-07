/**
 * World ↔ ThreadScheduler 适配层
 *
 * 将 World 的现有接口（LLMClient, Flow, Stone, Traits）
 * 桥接到 ThreadScheduler 的 SchedulerCallbacks 接口。
 *
 * 阶段 4 仅定义接口和桩实现。
 * 阶段 5 完成完整集成后，替换旧 Scheduler 的调用点。
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#6
 */

import { consola } from "consola";
import type { SchedulerCallbacks } from "./scheduler.js";
import type { ThreadsTreeNodeMeta } from "./types.js";

/**
 * 适配层依赖接口
 *
 * 由 World 在创建适配层时注入。
 * 使用接口而非直接依赖 World，避免循环引用。
 */
export interface WorldBridge {
  /** 执行一轮 ThinkLoop 迭代（阶段 3 的新 ThinkLoop） */
  runOneIteration: (threadId: string, objectName: string) => Promise<void>;
  /** 向线程 inbox 投递错误消息 */
  deliverErrorToInbox: (threadId: string, objectName: string, error: string) => void;
  /** 发射 SSE 进度事件 */
  emitProgress: (objectName: string, threadId: string, iterations: number) => void;
}

/**
 * 创建 SchedulerCallbacks
 *
 * 将 WorldBridge 适配为 ThreadScheduler 所需的回调接口。
 */
export function createSchedulerCallbacks(bridge: WorldBridge): SchedulerCallbacks {
  return {
    runOneIteration: async (threadId: string, objectName: string) => {
      await bridge.runOneIteration(threadId, objectName);
      bridge.emitProgress(objectName, threadId, 1);
    },

    onThreadFinished: (threadId: string, objectName: string) => {
      consola.info(`[WorldAdapter] 线程结束 ${threadId} (${objectName})`);
    },

    onThreadError: (threadId: string, objectName: string, error: string) => {
      bridge.deliverErrorToInbox(threadId, objectName, error);
    },
  };
}
