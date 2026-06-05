/**
 * ContextWindow 家族的 base 类型 —— canonical 源（batch C6 从
 * `executable/windows/_shared/types.ts` 迁入 base 部分）。
 *
 * 设计依据：docs/superpowers/specs/2026-05-14-context-window-unification-design.md
 *
 * **分层说明（batch C 关键决策）：**
 * 完整的 `ContextObject` discriminated union（`RootWindow | MethodExecWindow | …`）
 * 依赖 builtins 各包的具体 window 类型，**无法**放进零依赖的 `_shared`。因此：
 * - 本文件只导出 base：`ContextObject = BaseContextWindow & { [k]: unknown }`，
 *   够"只读 base 字段"的调用方（thread / registry / method ctx）使用。
 * - 完整 union 的 canonical 源仍是 `executable/windows/_shared/types.ts`——它 import
 *   本文件的 base 类型再拼装具体 window union（覆盖 base 版同名 export）。
 * - 需要 discriminant narrowing 的调用方显式从 executable 版引。
 *
 * 后续 ooc-7 再考虑把 builtins 具体类型也下沉到 `_shared`。
 */

/** Object 类型枚举。新增类型必须同步在 REGISTRY 中注册。 */
export type ObjectType =
  | "root"
  | "method_exec"
  | "do"
  | "todo"
  | "talk"
  | "program"
  | "file"
  | "knowledge"
  | "search"
  | "relation"
  | "skill_index"
  | "feishu_chat"
  | "feishu_doc"
  | "plan"
  | "guidance"
  | (string & {});

/**
 * Window 状态值汇总。
 *
 * - method_exec：open → executing → success | failed
 * - do：running → archived
 * - todo：open → done
 * - talk / program / file / knowledge：open → closed
 * - root：仅 active；与 thread 同生命周期，不能被关闭
 */
export type WindowStatus =
  | "open"
  | "executing"
  | "success"
  | "failed"
  | "running"
  | "archived"
  | "done"
  | "active"
  | "closed";

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
  score: number; // 0.0–1.0
  priorityHint?: "critical" | "high" | "normal" | "low";
  signalCount: number; // decaying counter of recent references
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

/**
 * ContextObject —— **base 版**（batch C6 分层决策）。
 *
 * 零依赖层只能表达"所有 window 至少有 BaseContextWindow 字段 + 任意扩展字段"。
 * 完整 discriminated union 在 `executable/windows/_shared/types.ts` 覆盖此 export。
 */
export type ContextObject = BaseContextWindow;

/** ContextWindow — 历史别名（pre-rename 名称），= ContextObject。 */
export type ContextWindow = ContextObject;

/** Root object 的固定 id。 */
export const ROOT_WINDOW_ID = "root";

/** Skill 索引 object 的固定 id（每个 thread 唯一一份）。 */
export const SKILL_INDEX_WINDOW_ID = "skill_index";

/** root thread 的 creator 约定值。 */
export const SESSION_CREATOR_THREAD_ID = "__session__";

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
