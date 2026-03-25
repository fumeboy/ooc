/**
 * 类型定义统一导出
 */

export type {
  TalkableFunction,
  Talkable,
  Thinkable,
  Relation,
  StoneData,
} from "./object.js";

export type {
  FlowStatus,
  ActionType,
  Action,
  MessageDirection,
  FlowMessage,
  PendingMessage,
  FlowData,
} from "./flow.js";

export type {
  DirectoryEntry,
  ContextWindow,
  WindowConfig,
  Context,
} from "./context.js";

export type {
  TraitMethodParam,
  TraitMethod,
  TraitWhen,
  TraitHookEvent,
  TraitHook,
  TraitDefinition,
} from "./trait.js";

export type {
  NodeStatus,
  ProcessNode,
  TodoItem,
  Signal,
  ThreadState,
  Process,
  HookTime,
  HookType,
  FrameHook,
} from "./process.js";
