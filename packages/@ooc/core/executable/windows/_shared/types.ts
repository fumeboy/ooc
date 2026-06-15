/**
 * ContextWindow 抽象 — 一个 thread 持有一组 ContextWindow（flat 数组，层级通过 parentObjectId 表达）。
 *
 * 核心思想：
 * - 每个 window 都是"持续占 context 的实体"，对 LLM 而言行为一致：通过 3 原语 exec /
 *   close / wait 与之交互。
 * - 各 class 的具体形态由 OocObjectInstance 三分表达：信封字段（id/class/title/status/
 *   createdAt/parentObjectId）由 runtime 管理，业务数据落 `.data`（该 class 的 `Data`），
 *   投影态落 `.win`（该 class 的 `Win`）。
 *
 * **对象模型收口（Wave 4）**：`ContextWindow` 不再是「每 class 一个平铺信封字段的成员」的
 * discriminated union，而**直接等于** `OocObjectInstance`——信封 + data + win 三分。需要按 class
 * narrow 的调用方读 `.class` 后把 `.data` 断言成对应 class 的 `Data`（本文件 re-export 各 class
 * 的 `Data`/`Win` 供断言）。各 builtin types.ts 的 `@deprecated XxxWindow` 平铺别名已随之删除。
 *
 * **分层**：base 部分（BaseContextWindow / WindowStatus / provenance / relevance / SharingState /
 * 常量 / id 工具函数）的 canonical 源在零依赖层 `@ooc/core/_shared/types/context-window.ts`；
 * 本文件 re-export 它们保持旧 import 路径可用，并把 `ContextWindow` 覆盖为 `OocObjectInstance`。
 */

import type { OocObjectInstance } from "../../../runtime/ooc-class.js";

// base 类型 / 常量 / 工具函数：从 _shared re-export（ContextWindow 除外——下方覆盖）
export type {
  WindowStatus,
  ContextWindowProvenance,
  ContextWindowRelevance,
  BaseContextWindow,
  SharingState,
} from "../../../_shared/types/context-window.js";
export {
  ROOT_WINDOW_ID,
  SKILL_INDEX_WINDOW_ID,
  SESSION_CREATOR_THREAD_ID,
  generateWindowId,
  creatorWindowIdOf,
  isNonPersistedWindow,
} from "../../../_shared/types/context-window.js";

// runtime object 实例信封 —— ContextWindow 的 canonical 形态。
export type { OocObjectInstance } from "../../../runtime/ooc-class.js";

// ─────────────────────────── per-class Data / Win re-exports ──────────────────
// 需要按 class narrow 的调用方：读 inst.class 后把 inst.data 断言成对应 Data。
// 这些是 class 的纯业务数据（不含信封/不含旧平铺别名）。

export type { Data as RootData } from "@ooc/builtins/root/types.js";
export type { Data as TodoData } from "@ooc/builtins/todo/types.js";
export type { TalkData, TalkWin } from "../talk/types.js";
export type { Data as PrData } from "@ooc/builtins/pr/types.js";
export type { Data as TerminalProcessData } from "@ooc/builtins/terminal_process/types.js";
export type { Data as InterpreterProcessData } from "@ooc/builtins/interpreter_process/types.js";
export type { ProcessExecRecord } from "@ooc/builtins/_shared/executable/process-record.js";
export type { Data as FileData } from "@ooc/builtins/file/types.js";
export type { Data as KnowledgeData } from "@ooc/builtins/knowledge/types.js";
export type { Data as SearchData, SearchMatch } from "@ooc/builtins/search/types.js";
export type { Data as SkillIndexData, SkillEntry } from "@ooc/builtins/skill_index/types.js";
export type { Data as PlanData, PlanWindowStep } from "@ooc/builtins/plan/types.js";
export type { Data as TerminalData } from "@ooc/builtins/terminal/types.js";
export type { Data as InterpreterData } from "@ooc/builtins/interpreter/types.js";
export type { Data as ThreadData } from "@ooc/builtins/thread/types.js";
export type { Data as FeishuChatData, FeishuChatMessage } from "@ooc/builtins/feishu_chat/types.js";
export type { Data as FeishuDocData, FeishuDocBlock } from "@ooc/builtins/feishu_doc/types.js";

/**
 * ContextWindow — canonical 形态（thread 维度，persist 到 thread-context.json）。
 *
 * = `OocObjectInstance`：信封（id/class/title/status/createdAt/parentObjectId）+ 业务 `.data`
 * + 投影态 `.win`。覆盖 `_shared` 的 base 版 `ContextWindow`（base 版是 `BaseContextWindow`，
 * 够只读 base 字段的调用方）。需要按 class narrow 的调用方读 `.class` 后断言 `.data`。
 */
export type ContextWindow = OocObjectInstance;
