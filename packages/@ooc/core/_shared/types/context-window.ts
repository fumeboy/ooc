/**
 * ContextWindow 家族类型 —— canonical 源。
 *
 * **对象模型收口（Wave 4）**：`ContextWindow` 不再是「每 class 一个平铺信封字段的成员」的
 * discriminated union，而**直接等于** `OocObjectInstance`——信封（id/class/title/status/
 * createdAt/parentObjectId）+ 业务 `.data` + 投影态 `.win`。需要按 class narrow 的调用方读
 * `.class` 后把 `.data` 断言成对应 class 的 `Data`（本文件 re-export 各 class 的 `Data`/`Win`
 * 供断言）。各 builtin types.ts 的 `@deprecated XxxWindow` 平铺别名已随之删除。
 *
 * base 部分（BaseContextWindow / WindowStatus / provenance / relevance / SharingState /
 * 常量 / id 工具函数）也在本零依赖层定义。
 */

import type { WindowDisplayState } from "./window-state.js";
import type { OocObjectInstance } from "../../runtime/ooc-class.js";

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
 *   自己降为只读 shadow（snapshot 冻结）。
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
 * ContextWindow — canonical 形态（thread 维度，persist 到 thread-context.json）。
 *
 * = `OocObjectInstance`：信封（id/class/title/status/createdAt/parentObjectId）+ 业务 `.data`
 * + 投影态 `.win`。需要按 class narrow 的调用方读 `.class` 后断言 `.data`。
 */
export type ContextWindow = OocObjectInstance;

/** runtime object 实例信封 —— ContextWindow 的 canonical 形态。 */
export type { OocObjectInstance } from "../../runtime/ooc-class.js";

// ─────────────────────────── per-class Data / Win re-exports ──────────────────
// 需要按 class narrow 的调用方：读 inst.class 后把 inst.data 断言成对应 Data。
// 这些是 class 的纯业务数据（不含信封/不含旧平铺别名）。
export type { Data as RootData } from "@ooc/builtins/root/types.js";
export type { Data as TodoData } from "@ooc/builtins/agent/todo/types.js";
export type { TalkData, TalkWin, TalkWindowView } from "@ooc/builtins/agent/thread/types.js";
export type { Data as PrData } from "@ooc/builtins/agent/pr/types.js";
export type { Data as TerminalProcessData } from "@ooc/builtins/terminal/terminal_process/types.js";
export type { Data as InterpreterProcessData } from "@ooc/builtins/interpreter/interpreter_process/types.js";
export type { ProcessExecRecord } from "@ooc/builtins/_shared/executable/process-record.js";
export type { Data as FileData } from "@ooc/builtins/filesystem/file/types.js";
export type { Data as KnowledgeData } from "@ooc/builtins/knowledge_base/knowledge/types.js";
export type { Data as SearchData, SearchMatch } from "@ooc/builtins/filesystem/search/types.js";
export type { Data as SkillIndexData, SkillEntry } from "@ooc/builtins/agent/skill_index/types.js";
export type { Data as PlanData, PlanWindowStep } from "@ooc/builtins/agent/plan/types.js";
export type { Data as TerminalData } from "@ooc/builtins/terminal/types.js";
export type { Data as InterpreterData } from "@ooc/builtins/interpreter/types.js";
export type { Data as ThreadData } from "@ooc/builtins/agent/thread/types.js";
export type { Data as FeishuChatData, FeishuChatMessage } from "@ooc/builtins/feishu_app/feishu_chat/types.js";
export type { Data as FeishuDocData, FeishuDocBlock } from "@ooc/builtins/feishu_app/feishu_doc/types.js";

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
