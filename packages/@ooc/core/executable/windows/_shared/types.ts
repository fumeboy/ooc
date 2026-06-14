/**
 * ContextWindow 抽象 — 取代旧的 ActiveForm + thread.windows + pinnedKnowledge 三套并列概念。
 *
 * 核心思想：
 * - 一个 thread 持有一组 ContextWindow（flat 数组，层级通过 parentWindowId 表达）
 * - 每个 window 都是"持续占 context 的实体"，对 LLM 而言行为一致：通过 3 原语 exec /
 *   close / wait 与之交互（exec 是命令调用入口；form 自身的 refine/submit 现在
 *   是 MethodExecWindow 上注册的命令，与其它 window 命令同构）
 * - 各 window type 通过 ObjectRegistry（registry.ts）声明自身注册的 method、关闭副作用与渲染规则
 *
 * **分层**：
 * - base 部分（BaseContextWindow / string / WindowStatus / provenance / relevance /
 *   SharingState / 常量 / id 工具函数）的 canonical 源已迁入零依赖层
 *   `@ooc/core/_shared/types/context-window.ts`；本文件 re-export 它们保持旧 import 路径可用。
 * - 完整 `ContextWindow` discriminated union 依赖 builtins 各包具体 window 类型，**无法**
 *   下沉到 `_shared`——其 canonical 源仍是本文件：import base，拼装具体 union，
 *   **覆盖** base 版同名 `ContextWindow` export。
 * - 需要 discriminant narrowing 的调用方从本文件引；只读 base 字段的调用方可从 `_shared` 引。
 *
 * ContextObject 正名为 ContextWindow（"context window"=展示单元，"Object"=OOP 实体）；
 * 已删除 deprecated 别名，全仓统一 ContextWindow。
 */

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

// ─────────────────────────── per-type interface re-exports ────────────────────

export type { RootWindow } from "@ooc/builtins/root/types.js";
export type { MethodExecWindow } from "../method_exec/types.js";
export type { TodoWindow } from "@ooc/builtins/todo/types.js";
export type { TalkWindow } from "../talk/types.js";
export type { PrWindow } from "@ooc/builtins/pr/types.js";
export type { ReflectRequestWindow } from "@ooc/builtins/reflect_request/types.js";
export type { ProgramWindow, ProgramExecRecord } from "@ooc/builtins/program/types.js";
export type { FileWindow } from "@ooc/builtins/file/types.js";
export type { KnowledgeWindow } from "@ooc/builtins/knowledge/types.js";
export type { SearchWindow, SearchMatch } from "@ooc/builtins/search/types.js";
export type { SkillIndexWindow, SkillEntry } from "@ooc/builtins/skill_index/types.js";
export type { PlanWindow, PlanWindowStep } from "@ooc/builtins/plan/types.js";
export type { FilesystemWindow } from "@ooc/builtins/filesystem/types.js";
export type { TerminalWindow } from "@ooc/builtins/terminal/types.js";
export type { WorldWindow } from "@ooc/builtins/world/types.js";
export type { KnowledgeBaseWindow } from "@ooc/builtins/knowledge_base/types.js";
export type { FeishuChatWindow, FeishuChatMessage } from "../../../extendable/lark/feishu-chat/types.js";
export type { FeishuDocWindow, FeishuDocBlock } from "../../../extendable/lark/feishu-doc/types.js";

// 用 import 形式拿到具体类型构造 ContextWindow union
import type { RootWindow } from "@ooc/builtins/root/types.js";
import type { MethodExecWindow } from "../method_exec/types.js";
import type { TodoWindow } from "@ooc/builtins/todo/types.js";
import type { TalkWindow } from "../talk/types.js";
import type { PrWindow } from "@ooc/builtins/pr/types.js";
import type { ReflectRequestWindow } from "@ooc/builtins/reflect_request/types.js";
import type { ProgramWindow } from "@ooc/builtins/program/types.js";
import type { FileWindow } from "@ooc/builtins/file/types.js";
import type { KnowledgeWindow } from "@ooc/builtins/knowledge/types.js";
import type { SearchWindow } from "@ooc/builtins/search/types.js";
import type { SkillIndexWindow } from "@ooc/builtins/skill_index/types.js";
import type { PlanWindow } from "@ooc/builtins/plan/types.js";
import type { FilesystemWindow } from "@ooc/builtins/filesystem/types.js";
import type { TerminalWindow } from "@ooc/builtins/terminal/types.js";
import type { WorldWindow } from "@ooc/builtins/world/types.js";
import type { KnowledgeBaseWindow } from "@ooc/builtins/knowledge_base/types.js";
import type { FeishuChatWindow } from "../../../extendable/lark/feishu-chat/types.js";
import type { FeishuDocWindow } from "../../../extendable/lark/feishu-doc/types.js";

/**
 * ContextWindow — canonical union type（thread 维度，persist 到 thread-context.json）。
 *
 * 覆盖 `_shared` 的 base 版 `ContextWindow`：base 版是 `BaseContextWindow & { [k]: unknown }`
 * （够只读 base 字段的调用方），本 union 是带 discriminant 的精确类型（需 narrowing 的调用方）。
 *
 * 新增 type 后必须扩这里 + REGISTRY。
 */
export type ContextWindow =
  | RootWindow
  | MethodExecWindow
  | TodoWindow
  | TalkWindow
  | PrWindow
  | ReflectRequestWindow
  | ProgramWindow
  | FileWindow
  | KnowledgeWindow
  | SearchWindow
  | SkillIndexWindow
  | FeishuChatWindow
  | FeishuDocWindow
  | PlanWindow
  | FilesystemWindow
  | TerminalWindow
  | WorldWindow
  | KnowledgeBaseWindow;
