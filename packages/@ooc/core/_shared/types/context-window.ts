/**
 * ContextWindow 家族的 base 类型 —— canonical 源（从
 * `executable/windows/_shared/types.ts` 迁入 base 部分）。
 *
 * **分层说明：**
 * 完整的 `ContextWindow` discriminated union（`RootWindow | MethodExecWindow | …`）
 * 依赖 builtins 各包的具体 window 类型，**无法**放进零依赖的 `_shared`。因此：
 * - 本文件只导出 base：`ContextWindow = BaseContextWindow & { [k]: unknown }`，
 *   够"只读 base 字段"的调用方（thread / registry / method ctx）使用。
 * - 完整 union 的 canonical 源仍是 `executable/windows/_shared/types.ts`——它 import
 *   本文件的 base 类型再拼装具体 window union（覆盖 base 版同名 export）。
 * - 需要 discriminant narrowing 的调用方显式从 executable 版引。
 *
 */

import type { WindowDisplayState } from "./window-state.js";

/**
 * Window 状态值汇总。
 *
 * - method_exec：open → executing → success | failed
 * - todo：open → done
 * - talk / program / file / knowledge：open → closed（talk fork 子窗的子线程"运行中"状态挂 thread.status）
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
 * Why a ContextWindow is present in context. Set by the mechanism that created the window.
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
 * Semantic importance of a ContextWindow, used by BudgetManager for overflow decisions.
 * unset = computed at render time from defaults.
 */
export interface ContextWindowRelevance {
  score: number; // 0.0–1.0
  priorityHint?: "critical" | "high" | "normal" | "low";
  signalCount: number; // decaying counter of recent references
}

/**
 * 所有 ContextWindow 共享的字段。
 *
 * - id：全局唯一稳定 ID（root 固定为 "root"，其它类型用 generateWindowId）
 * - parentWindowId：method_exec 必有 parent；其它类型不显式挂 parent 时默认在 root 下
 * - title：所有 window 强制必填
 * - windowKnowledgePaths：本 window 自身关联的 knowledge path（用于 close 时释放引用计数）
 * - sharing：跨 thread 引用模式；缺省 = mutable-ref（owner，可调全部 method）
 */
export interface BaseContextWindow {
  id: string;
  class: string;
  parentWindowId?: string;
  title: string;
  status: WindowStatus;
  createdAt: number;
  windowKnowledgePaths?: string[];
  /** 跨 thread 引用模式；缺省 = mutable-ref（owner）。 */
  sharing?: SharingState;
  /**
   * 上下文压缩档位。
   *
   * - undefined / 0 → live 全量渲染（默认）
   * - 1              → folded 折叠态
   * - 2              → snapshot 仅元信息
   */
  compressLevel?: 0 | 1 | 2;
  /**
   * 该 window 的"有效可见渲染类型"——沿 parentClass 继承链回退后
   * 首个能被前端 ContextSnapshotViewer 渲染的 type。
   *
   * undefined = 未计算或回退到原始 type。
   */
  effectiveVisibleType?: string;
  provenance?: ContextWindowProvenance;
  relevance?: ContextWindowRelevance;
  boundFormId?: string;
  /**
   * 展示状态对象（viewport / lines / columns / transcriptViewport…）。
   * 与业务数据分离，由 readable 维度的 WindowMethod 读写、readable 函数读取，随 window
   * 持久化在 thread-context。缺省 = 无展示状态（按默认渲染）。
   */
  state?: WindowDisplayState;
  /**
   * Object 自我门面窗（id=type=objectId，由 initContextWindows 每次 thread 加载幂等重注入）。
   * 它从对象身份确定性重建、无独立 state.json，**不应持久化**——否则 thread-context.json 落成
   * 指向缺失 state.json 的死 _ref，reload 刷屏 `references missing object <id>`。
   * 写盘端经 isNonPersistedWindow 统一剔除。
   */
  isSelfWindow?: boolean;
  /**
   * Member-facade 窗（agent 经组合声明持有的 tool-object 成员，如 filesystem）。
   * 与 self 窗同理：由 injectMemberWindowsIfObjectThread 每次 thread 加载幂等重注入、
   * 从类声明确定性重建、无独立 state.json，**不应持久化**——否则 thread-context.json 落死 _ref。
   * 写盘端经 isNonPersistedWindow 统一剔除。
   */
  isMemberWindow?: boolean;
  /**
   * Plain-string tip set by onFormChange. Only present on method_exec windows.
   * Rendered directly on the form; replaces the old guidance-window machinery.
   */
  tip?: string;
}

/**
 * 跨 thread 引用模式
 *
 * 缺省（无 sharing 字段）= **mutable-ref**：所有者，可调该窗全部 method。
 * 显式 sharing 标记非缺省态：
 * - kind="readonly-ref"：我（当前 thread）持有只读引用，只能调 window method；
 *   owner 在 ownerThreadId；snapshot 是 share 时刻的 freeze。
 * - kind="mutable-ref"：我曾是 owner，已把 mutable 所有权 move 给 borrowerThreadId，
 *   自己降为只读 shadow（snapshot 冻结）。`move` 是动作（核心 11），非稳态。
 */
export type SharingState =
  | {
      kind: "readonly-ref";
      ownerThreadId: string;
      lentByWindowId: string;
      sharedAt: number;
      snapshot: ContextWindow;
    }
  | {
      kind: "mutable-ref";
      borrowerThreadId: string;
      lentToWindowId: string;
      sharedAt: number;
      snapshot: ContextWindow;
    };

/**
 * ContextWindow —— **base 版**（正名为 ContextWindow）。
 *
 * 零依赖层只能表达"所有 window 至少有 BaseContextWindow 字段 + 任意扩展字段"。
 * 完整 discriminated union 在 `executable/windows/_shared/types.ts` 覆盖此 export。
 */
export type ContextWindow = BaseContextWindow;

/** Root object 的固定 id。 */
export const ROOT_WINDOW_ID = "root";

/** Skill 索引 object 的固定 id（每个 thread 唯一一份）。 */
export const SKILL_INDEX_WINDOW_ID = "skill_index";

/** root thread 的 creator 约定值。 */
export const SESSION_CREATOR_THREAD_ID = "__session__";

/** 生成 object id；前缀按类型区分，便于日志阅读。 */
export function generateWindowId(type: string): string {
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
  };
  const prefix = prefixMap[type] ?? "w_obj";
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 派生稳定的 creator 会话窗 id（talk window，指向 creator）。 */
export function creatorWindowIdOf(threadId: string): string {
  return `w_creator_${threadId}`;
}

/**
 * 不应持久化进 thread-context.json 的窗：self 门面窗。
 * 由 init 每轮确定性重建，落盘只会变成死 _ref 刷屏（见 isSelfWindow 标记）。
 * 写盘端用本谓词统一剔除。
 */
export function isNonPersistedWindow(window: BaseContextWindow): boolean {
  return window.isSelfWindow === true || window.isMemberWindow === true;
}
