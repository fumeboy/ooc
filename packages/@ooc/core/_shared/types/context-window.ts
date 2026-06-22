/**
 * ContextWindow 家族类型 —— canonical 源。
 *
 * **对象模型收口（Wave 4）**：`ContextWindow` 不再是「每 class 一个平铺元信息字段的成员」的
 * discriminated union，而**直接等于** `OocObjectRef`——元信息（id/class/title/status/
 * createdAt/parentWindowId）+ 业务 `.data` + 投影态 `.win`。需要按 class narrow 的调用方读
 * `.class` 后把 `.data` 断言成对应 class 的 `Data`（本文件 re-export 各 class 的 `Data`/`Win`
 * 供断言）。各 builtin types.ts 的 `@deprecated XxxWindow` 平铺别名已随之删除。
 *
 * base 部分（WindowStatus / 常量 / id 工具函数）也在本零依赖层定义。
 */

import type { OocObjectRef, OocObjectInstance } from "../../runtime/ooc-class.js";

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
 * = `OocObjectRef`：对 object 的引用（id=objectId + 缓存 class）+ 视角态（title/status/createdAt/
 * parentWindowId/win/closable）。**不持 data**——data 在 session 对象表（按 id 解析，见 `objectDataOf`）。
 */
export type ContextWindow = OocObjectRef;

/** object 实例（持 data，活在 session 对象表）+ context window（对它的引用）。 */
export type { OocObjectRef, OocObjectInstance } from "../../runtime/ooc-class.js";

// ─────────────────── object 解析 accessor（读者经此取 object data/class，而非直读窗）───────────────────
// B→A：context window（OocObjectRef）只持 objectId(=id)+缓存 class，**不持 data**；object data 活在
// session 对象表（`Map<objectId, OocObjectInstance>`，挂线程树根，见 runtime/session-object-table.ts）。
// - classOf(ref)=ref.class（缓存、免查表）。
// - objectDataOf(ref, table) 经对象表按 ref.id 解析 data（table 由调用方 `getSessionObjectTable(thread)`
//   取并传入，避免 _shared→runtime 循环依赖）。读「窗自身视角态」(status/title/win/closable/id)→直读窗。

/** 取 context window 所引用对象的业务 data —— 经 session 对象表按 `ref.id` 解析。 */
export function objectDataOf<Data = unknown>(
  w: OocObjectRef,
  table: Map<string, OocObjectInstance>,
): Data {
  return (table.get(w.id) as OocObjectInstance<Data> | undefined)?.data as Data;
}

/** 取 context window 所引用对象的**注册 class**（缓存在窗上；非投影 class，投影 class 渲染期算）。 */
export function classOf(w: OocObjectRef): string {
  return w.class;
}

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
 *
 * B→A：窗不持 data，故经 session 对象表（`table`，调用方 `getSessionObjectTable(thread)` 取）解析。
 */
export function hasCreatorChannel(
  w: OocObjectRef,
  table: Map<string, OocObjectInstance>,
): boolean {
  if (!isSelfThreadWindow(w.id)) return false;
  const d = (objectDataOf(w, table) ?? {}) as { target?: string; isForkWindow?: boolean };
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
