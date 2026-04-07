/**
 * 线程树模块
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md
 */

/* 阶段 1: 类型 + 持久化 */
export * from "./types.js";
export * from "./persistence.js";

/* 阶段 2: 内存树模型 */
export * from "./queue.js";
export * from "./tree.js";

/* 阶段 3: ThinkLoop + Context 构建 */
export * from "./parser.js";
export * from "./hooks.js";
export * from "./context-builder.js";
export * from "./thinkloop.js";

/* 阶段 4: Scheduler + World 适配 */
export { ThreadScheduler, type ThreadSchedulerConfig, type SchedulerCallbacks } from "./scheduler.js";
export { createSchedulerCallbacks, type WorldBridge } from "./world-adapter.js";

/* 阶段 5: 协作 API + inbox 清理 */
export * from "./inbox.js";
export {
  createCollaborationAPI,
  onTalkHandlerReturn,
  commentOnIssueWithNotify,
  type CollaborationContext,
  type ObjectResolver,
  type ThreadCollaborationAPI,
  type SharedTalkRoundCounter,
} from "./collaboration.js";

/* 阶段 6: 执行引擎（集成层） */
export { runWithThreadTree, type EngineConfig, type TalkResult } from "./engine.js";
