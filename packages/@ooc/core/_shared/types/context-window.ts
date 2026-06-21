/**
 * ContextWindow 家族类型 —— canonical 源。
 *
 * **对象模型收口（Wave 4）**：`ContextWindow` 不再是「每 class 一个平铺元信息字段的成员」的
 * discriminated union，而**直接等于** `OocObjectInstance`——元信息（id/class/title/status/
 * createdAt/parentObjectId）+ 业务 `.data` + 投影态 `.win`。需要按 class narrow 的调用方读
 * `.class` 后把 `.data` 断言成对应 class 的 `Data`（本文件 re-export 各 class 的 `Data`/`Win`
 * 供断言）。各 builtin types.ts 的 `@deprecated XxxWindow` 平铺别名已随之删除。
 *
 * base 部分（WindowStatus / 常量 / id 工具函数）也在本零依赖层定义。
 */

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
 * ContextWindow — canonical 形态（thread 维度，persist 到 thread-context.json）。
 *
 * = `OocObjectInstance`：元信息（id/class/title/status/createdAt/parentObjectId）+ 业务 `.data`
 * + 投影态 `.win`。需要按 class narrow 的调用方读 `.class` 后断言 `.data`。
 */
export type ContextWindow = OocObjectInstance;

/** runtime object 实例 —— ContextWindow 的 canonical 形态。 */
export type { OocObjectInstance } from "../../runtime/ooc-class.js";

// ───────────────── object / context-window 拆分（P0 draft 类型，additive、未启用）─────────────────
// 设计裁决：docs/issues/2026-06-21-object-contextwindow-split.md（方案 B：inline-vs-ref 对齐持久）。
// 当前 `ContextWindow = OocObjectInstance`（一 struct 混装 object 身份 + window 视角态）是已知债。
// 目标：**object 是持久身份**（OocObject）、**context window 是对 object 的引用 + 本窗视角态**
// （InlineWindow 内联 object / RefWindow 仅持 ref，对齐持久 inline/_ref）。投影 class 渲染期算、不入窗结构。
// P0 仅引入类型、**不启用**（ContextWindow 仍 = OocObjectInstance）；P1 起接 WindowManager 并切 union。

/** object —— 持久身份：注册 class（恒真实 class、非投影 class）+ 业务 data。一份、可被多窗引用。 */
export interface OocObject<Data = unknown> {
  id: string;
  class: string;
  data: Data;
}

/** context window 视角态信封（两形态共有；与 object data 分离落盘）。 */
export interface WindowView<Win = unknown> {
  id: string;
  status: WindowStatus;
  title: string;
  createdAt: number;
  parentObjectId?: string;
  /** 结构窗保护：construct 标 false → close 原语拒关（对象模型核心 10）。 */
  closable?: boolean;
  /** 投影态（window method 读写、与 object data 分离）；投影 class 渲染期算、不入此结构。 */
  win?: Win;
}

/** A 态：object 内联（thread 自有窗 / talk / todo 等 isInlinePersisted=true，整窗随 thread 落盘）。 */
export interface InlineWindow<Data = unknown, Win = unknown> extends WindowView<Win> {
  object: { class: string; data: Data };
}

/** B 态：只持对 object 的引用，data 经 WindowManager objectCache 解析（P2）；id = objectId（现 1:1）。 */
export interface RefWindow<Win = unknown> extends WindowView<Win> {
  objectRef: { objectId: string; class: string };
}

/** 拆分后 context window 的目标形态（P1 起切换；P0 未启用，故另名、暂不替换 ContextWindow）。 */
export type ContextWindowSplit = InlineWindow | RefWindow;

// ─────────────────────────── per-class Data / Win re-exports ──────────────────
// 需要按 class narrow 的调用方：读 inst.class 后把 inst.data 断言成对应 Data。
// 这些是 class 的纯业务数据（不含元信息/不含旧平铺别名）。
export type { Data as TodoData } from "@ooc/builtins/agent/todo/types.js";
export type { TalkData, TalkWin, TalkWindowView } from "@ooc/builtins/agent/thread/types.js";
export type { Data as PrData } from "@ooc/builtins/agent/pr/types.js";
export type { Data as TerminalProcessData } from "@ooc/builtins/terminal/terminal_process/types.js";
export type { Data as InterpreterProcessData } from "@ooc/builtins/interpreter/interpreter_process/types.js";
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

/** root thread 的 creator 约定值。 */
export const SESSION_CREATOR_THREAD_ID = "__session__";

/** 生成 object id；前缀按类型区分，便于日志阅读。 */
export function generateWindowId(type: string): string {
  const prefixMap: Record<string, string> = {
    method_exec: "f",
    todo: "w_todo",
    talk: "w_talk",
    file: "w_file",
    knowledge: "w_kn",
    search: "w_search",
    relation: "w_rel",
    feishu_chat: "w_fschat",
    feishu_doc: "w_fsdoc",
    plan: "w_plan",
  };
  const prefix = prefixMap[type] ?? "w_obj";
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** thread 窗 id 的稳定前缀（thread 窗身份编码在 id 里；字符串保留 w_creator_ 以兼容已持久化 thread-context.json）。 */
export const THREAD_WINDOW_ID_PREFIX = "w_creator_";

/** 派生稳定的 thread 窗 id（自己视角的过程窗；有 creator 时即与 creator 的恒在通道）。 */
export function threadWindowIdOf(threadId: string): string {
  return `${THREAD_WINDOW_ID_PREFIX}${threadId}`;
}

/**
 * 该窗是不是本 thread 那**唯一一个** thread 窗（自己视角的过程窗）。
 *
 * thread 窗身份编码在 id（`threadWindowIdOf`），纯由 id 判定。一条 thread 的 context 里至多一条
 * （id=`w_creator_<本thread.id>`）；peer/self/member/工具窗都不以此前缀开头。
 * 注意：本谓词只答"是不是过程窗"，不答"有没有上游 creator"——后者用 `hasCreatorChannel`。
 */
export function isSelfThreadWindow(id: string): boolean {
  return id.startsWith(THREAD_WINDOW_ID_PREFIX);
}

/**
 * 本 thread 窗有没有真正的**上游 creator 通道**（可 say / 可 wait / 可 auto-reply 的对端）。
 * = 是自己的 thread 窗（`isSelfThreadWindow`）且 data 带 creator 端点（target 或 isForkWindow）。
 * self-driven root 的 thread 窗：是过程窗但**无上游** → 此谓词为假 → 不触发任何 creator affordance
 * （say 菜单 / wait IO 源 / end auto-reply / creator-reply 协议知识都 gate 在此）。
 */
export function hasCreatorChannel(w: { id: string; data?: unknown }): boolean {
  if (!isSelfThreadWindow(w.id)) return false;
  const d = (w.data ?? {}) as { target?: string; isForkWindow?: boolean };
  return d.target != null || d.isForkWindow === true;
}

/**
 * 不应持久化进 thread-context.json 的窗：self 门面窗 + member 门面窗。
 *
 * 两者都由 init 每轮从对象身份/类声明确定性重注入（initContextWindows /
 * injectMemberWindowsIfObjectThread），无独立 data.json，**不应持久化**——否则落成指向缺失
 * data.json 的死 _ref，reload 刷屏 `references missing object <id>`。
 *
 * 标记落在窗的**投影态 `win`** 上（`win:{transient:true,isSelfWindow:true}` /
 * `win:{transient:true,isMemberWindow:true}`），不在实例顶层——故本谓词读 `win`。写盘端
 * （thread-persist.buildEntries）用它统一剔除。
 */
export function isNonPersistedWindow(window: { win?: unknown }): boolean {
  const win = window.win as
    | { isSelfWindow?: boolean; isMemberWindow?: boolean }
    | undefined;
  return win?.isSelfWindow === true || win?.isMemberWindow === true;
}
