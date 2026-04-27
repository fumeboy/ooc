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
  ContextWindowSource,
} from "./context.js";

export type {
  TraitType,
  TraitMethodParam,
  TraitMethod,
  TraitMethodChannel,
  TraitNamespace,
  TraitKind,
  TraitHookEvent,
  TraitHook,
  TraitDefinition,
  TraitTree,
} from "./trait.js";

export type {
  NodeStatus,
  ProcessNode,
  Process,
} from "./process.js";

export type { ToolResult } from "./tool-result.js";
export { toolOk, toolErr } from "./tool-result.js";
