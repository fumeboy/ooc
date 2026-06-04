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
 * 类型组织（plan §12 标准化 + 用户 #18 请求）：
 * - 每个 builtin object type 的 interface 定义在 <type>/types.ts
 * - 本文件保留：BaseContextWindow / ObjectType / WindowStatus / ContextObject union /
 *   公共常量与 id 工具函数 / re-export 各子目录 types.ts
 *
 * P6 ooc-6 命名分层（2026-06-03 ooc-6 cleanup，Phase A）：
 *   ObjectType     = canonical（原 ObjectType 重命名，旧名已删除）
 *   ContextObject  = canonical（原 ContextObject，旧名已删除）
 *   ContextWindow  = alias to ContextObject（历史名称保留，不再 deprecated）
 */

/** Object 类型枚举（canonical，2026-06-03 ooc-6 cleanup Phase A：原 ObjectType 重命名）。新增类型必须同步在 REGISTRY 中注册。 */
export type ObjectType = "root" | "method_exec" | "do" | "todo" | "talk" | "program" | "file" | "knowledge" | "search" | "relation" | "skill_index" | "feishu_chat" | "feishu_doc" | "plan" | "guidance" | (string & {});

/**
 * Window 状态值汇总。
 *
 * - method_exec：open → executing → success | failed
 *   - 成功 (success) 后系统自动从 contextObjects 移除
 *   - 失败 (failed) 保留 result（错误信息）；可通过 refine 回 open 重 submit
 * - do：running → archived
 * - todo：open → done
 * - talk：open → closed
 * - program：open → closed
 * - file / knowledge：open → closed
 * - root：仅 active；与 thread 同生命周期，不能被关闭
 */
export type WindowStatus = "open" | "executing" | "success" | "failed" | "running" | "archived" | "done" | "active" | "closed";

/**
 * Why a ContextObject is present in context. Set by the mechanism that created the object.
 * unset = legacy / unknown (treated as "explicit" for safety — won't be auto-unloaded).
 */
export interface ContextWindowProvenance {
  kind: "explicit" | "derived" | "system" | "related";
  reason: {
    mechanism:
      | "user_open"
      | "llm_exec"
      | "intent_match"
      | "peer_discovery"
      | "form_bound"
      | "session_constant";
    sourceId?: string;
    detail?: Record<string, unknown>;
  };
  createdAt: number;
  lastTouchedAt: number;
}

/**
 * Semantic importance of a ContextObject, used by BudgetManager for overflow decisions.
 * unset = computed at render time from defaults.
 */
export interface ContextWindowRelevance {
  score: number;                          // 0.0–1.0
  priorityHint?: "critical" | "high" | "normal" | "low";
  signalCount: number;                    // decaying counter of recent references
}

/**
 * 所有 ContextObject 共享的字段。
 *
 * - id：全局唯一稳定 ID（root 固定为 "root"，其它类型用 generateWindowId）
 * - parentWindowId：method_exec 必有 parent；其它类型不显式挂 parent 时默认在 root 下
 * - title：所有 window 强制必填
 * - windowKnowledgePaths：本 object 自身关联的 knowledge path（用于 close 时释放引用计数）
 * - sharing：跨 thread 共享状态；缺省 = 该 thread 独占持有（owner，可正常操作）
 */
export interface BaseContextWindow {
  id: string;
  type: ObjectType;
  parentWindowId?: string;
  title: string;
  status: WindowStatus;
  createdAt: number;
  windowKnowledgePaths?: string[];
  /** 跨 thread 共享状态；缺省 = owner-live。 */
  sharing?: SharingState;
  /**
   * 上下文压缩档位（design: docs/2026-05-25-context-compression-design.md §4.1）。
   *
   * - undefined / 0 → live 全量渲染（默认）
   * - 1              → folded 折叠态
   * - 2              → snapshot 仅元信息
   */
  compressLevel?: 0 | 1 | 2;
  /**
   * P6.§7 (2026-06-02): 该 object 的"有效可见渲染类型"——沿 parentClass 继承链回退后
   * 首个能被前端 ContextSnapshotViewer 渲染的 type。
   *
   * undefined = 未计算或回退到原始 type。
   */
  effectiveVisibleType?: string;
  provenance?: ContextWindowProvenance;
  relevance?: ContextWindowRelevance;
  boundFormId?: string;
}

/**
 * 跨 thread 共享 ContextObject 的状态。
 *
 * - kind="ref"：我（当前 thread）持有的是只读 ref；snapshot 是分享时刻的 freeze。
 * - kind="lent_out"：我曾是 owner，已把 owner 移交给 borrowerThreadId。
 */
export type SharingState =
  | {
      kind: "ref";
      ownerThreadId: string;
      lentByWindowId: string;
      sharedAt: number;
      snapshot: ContextObject;
    }
  | {
      kind: "lent_out";
      borrowerThreadId: string;
      lentToWindowId: string;
      sharedAt: number;
      snapshot: ContextObject;
    };

// ─────────────────────────── per-type interface re-exports ────────────────────

/**
 * GuidanceWindow — form-bound contextual guidance, produced by onFormChange().
 *
 * Semantically a lightweight, transient sibling of KnowledgeWindow: it carries a
 * plain text `content` payload (the guidance text) and is always bound to a
 * specific form via `boundFormId`. Rendered as <guidance> children inside the
 * owning form's window block.
 */
export interface GuidanceWindow extends BaseContextWindow {
  type: "guidance";
  parentWindowId: string;
  boundFormId: string;
  provenance: ContextWindowProvenance & { reason: { mechanism: "form_bound" } };
  relevance: ContextWindowRelevance;
  content: string;
  summary: string;
}

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
 * 2026-06-03 ooc-6 cleanup Phase A：原 `ContextObject` 重命名为 `ContextObject`。
 * ContextObject 名称已删除。
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
 * ContextWindow — 历史别名（pre-rename 名称），保留供现有代码引用。
 * 2026-06-03 ooc-6 cleanup Phase A：移除 @deprecated，保留名称。
 */
export type ContextWindow = ContextObject;

/** Root object 的固定 id。 */
export const ROOT_WINDOW_ID = "root";

/** Skill 索引 object 的固定 id（每个 thread 唯一一份）。 */
export const SKILL_INDEX_WINDOW_ID = "skill_index";

/** 生成 object id；前缀按类型区分，便于日志阅读。 */
export function generateWindowId(type: Exclude<ObjectType, "root">): string {
  const prefixMap: Record<string, string> = {
    method_exec: "f",
    do: "w_do",
    todo: "w_todo",
    talk: "w_talk",
    program: "w_prog",
    file: "w_file",
    knowledge: "w_kn",
    search: "w_search",
    relation: "w_rel",
    skill_index: "w_skills",
    feishu_chat: "w_fschat",
    feishu_doc: "w_fsdoc",
    plan: "w_plan",
    guidance: "w_guide",
  };
  const prefix = prefixMap[type] ?? "w_obj";
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 派生稳定的 creator do_window id。 */
export function creatorWindowIdOf(threadId: string): string {
  return `w_creator_${threadId}`;
}

/** root thread 的 creator 约定值。 */
export const SESSION_CREATOR_THREAD_ID = "__session__";
