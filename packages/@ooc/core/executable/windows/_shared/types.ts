/**
 * ContextObject 抽象 — 取代旧的 ActiveForm + thread.windows + pinnedKnowledge 三套并列概念。
 *
 * 设计依据：docs/superpowers/specs/2026-05-14-context-window-unification-design.md
 *
 * 核心思想：
 * - 一个 thread 持有一组 ContextObject（flat 数组，层级通过 parentWindowId 表达）
 * - 每个 object 都是"持续占 context 的实体"，对 LLM 而言行为一致：通过 3 原语 exec /
 *   close / wait 与之交互（exec 是命令调用入口；form 自身的 refine/submit 现在
 *   是 MethodExecWindow 上注册的命令，与其它 object 命令同构）
 * - 各 object type 通过 ObjectRegistry（registry.ts）声明自身注册的 command、关闭副作用与渲染规则
 *
 * **batch C6 分层（2026-06-05 ooc-6）**：
 * - base 部分（BaseContextWindow / ObjectType / WindowStatus / provenance / relevance /
 *   SharingState / GuidanceWindow / 常量 / id 工具函数）的 canonical 源已迁入零依赖层
 *   `@ooc/core/_shared/types/context-window.ts`；本文件 re-export 它们保持旧 import 路径可用。
 * - 完整 `ContextObject` discriminated union 依赖 builtins 各包具体 window 类型，**无法**
 *   下沉到 `_shared`——其 canonical 源仍是本文件：import base，拼装具体 union，
 *   **覆盖** base 版同名 `ContextObject` / `ContextWindow` export。
 * - 需要 discriminant narrowing 的调用方从本文件引；只读 base 字段的调用方可从 `_shared` 引。
 */

// base 类型 / 常量 / 工具函数：从零依赖层 re-export（ContextObject / ContextWindow 除外——下方覆盖）
export type {
  ObjectType,
  WindowStatus,
  ContextWindowProvenance,
  ContextWindowRelevance,
  BaseContextWindow,
  SharingState,
  GuidanceWindow,
} from "../../../_shared/types/context-window.js";
export {
  ROOT_WINDOW_ID,
  SKILL_INDEX_WINDOW_ID,
  SESSION_CREATOR_THREAD_ID,
  generateWindowId,
  creatorWindowIdOf,
  isVolatileDerivedWindow,
  isNonPersistedWindow,
} from "../../../_shared/types/context-window.js";

// base ContextObject 仅供本文件 SharingState snapshot 兜底语义；具体 union 在下方覆盖 export
import type { GuidanceWindow } from "../../../_shared/types/context-window.js";

// ─────────────────────────── per-type interface re-exports ────────────────────

export type { RootWindow } from "@ooc/builtins/root/types.js";
export type { MethodExecWindow } from "../method_exec/types.js";
export type { DoWindow } from "../do/types.js";
export type { TodoWindow } from "@ooc/builtins/todo/types.js";
export type { TalkWindow } from "../talk/types.js";
export type { ProgramWindow, ProgramExecRecord } from "@ooc/builtins/program/types.js";
export type { FileWindow } from "@ooc/builtins/file/types.js";
export type { KnowledgeWindow } from "@ooc/builtins/knowledge/types.js";
export type { SearchWindow, SearchMatch } from "@ooc/builtins/search/types.js";
/** @deprecated ooc-6: RelationWindow replaced by peer Object auto-injection. Kept for backward compat. */
export type { RelationWindow } from "../relation/types.js";
export type { SkillIndexWindow, SkillEntry } from "@ooc/builtins/skill_index/types.js";
export type { PlanWindow, PlanWindowStep } from "@ooc/builtins/plan/types.js";
export type { FeishuChatWindow, FeishuChatMessage } from "../../../extendable/lark/feishu-chat/types.js";
export type { FeishuDocWindow, FeishuDocBlock } from "../../../extendable/lark/feishu-doc/types.js";

// 用 import 形式拿到具体类型构造 ContextObject union
import type { RootWindow } from "@ooc/builtins/root/types.js";
import type { MethodExecWindow } from "../method_exec/types.js";
import type { DoWindow } from "../do/types.js";
import type { TodoWindow } from "@ooc/builtins/todo/types.js";
import type { TalkWindow } from "../talk/types.js";
import type { ProgramWindow } from "@ooc/builtins/program/types.js";
import type { FileWindow } from "@ooc/builtins/file/types.js";
import type { KnowledgeWindow } from "@ooc/builtins/knowledge/types.js";
import type { SearchWindow } from "@ooc/builtins/search/types.js";
/** @deprecated ooc-6: replaced by peer Object auto-injection; kept for backward compat */
import type { RelationWindow } from "../relation/types.js";
import type { SkillIndexWindow } from "@ooc/builtins/skill_index/types.js";
import type { PlanWindow } from "@ooc/builtins/plan/types.js";
import type { FeishuChatWindow } from "../../../extendable/lark/feishu-chat/types.js";
import type { FeishuDocWindow } from "../../../extendable/lark/feishu-doc/types.js";

/**
 * ContextObject — canonical union type（thread 维度，persist 到 thread-context.json）。
 *
 * 覆盖 `_shared` 的 base 版 `ContextObject`：base 版是 `BaseContextWindow & { [k]: unknown }`
 * （够只读 base 字段的调用方），本 union 是带 discriminant 的精确类型（需 narrowing 的调用方）。
 *
 * 新增 type 后必须扩这里 + REGISTRY。
 */
export type ContextObject =
  | RootWindow
  | MethodExecWindow
  | DoWindow
  | TodoWindow
  | TalkWindow
  | ProgramWindow
  | FileWindow
  | KnowledgeWindow
  | SearchWindow
  /** @deprecated ooc-6: replaced by peer Object auto-injection; kept for backward compat */
  | RelationWindow
  | SkillIndexWindow
  | FeishuChatWindow
  | FeishuDocWindow
  | PlanWindow
  | GuidanceWindow;

/**
 * ContextWindow — 历史别名（pre-rename 名称），= 本文件的具体 union ContextObject。
 * 覆盖 `_shared` 的 base 版 ContextWindow。
 */
export type ContextWindow = ContextObject;
