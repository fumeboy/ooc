/**
 * ContextWindow 抽象 — 取代旧的 ActiveForm + thread.windows + pinnedKnowledge 三套并列概念。
 *
 * 设计依据：docs/superpowers/specs/2026-05-14-context-window-unification-design.md
 *
 * 核心思想：
 * - 一个 thread 持有一组 ContextWindow（flat 数组，层级通过 parentWindowId 表达）
 * - 每个 window 都是"持续占 context 的实体"，对 LLM 而言行为一致：通过 3 原语 exec /
 *   close / wait 与之交互（exec 是命令调用入口；form 自身的 refine/submit 现在
 *   是 CommandExecWindow 上注册的命令，与其它 window 命令同构）
 * - 各 window type 通过 WindowRegistry（registry.ts）声明自身注册的 command、关闭副作用与渲染规则
 *
 * 类型组织（plan §12 标准化 + 用户 #18 请求）：
 * - 每个 builtin window type 的 interface 定义在 windows/<type>/types.ts
 * - 本文件保留：BaseContextWindow / WindowType / WindowStatus / ContextWindow union /
 *   公共常量与 id 工具函数 / re-export 各子目录 types.ts
 */

/** Window 类型枚举；新增类型必须同步在 WINDOW_REGISTRY 中注册。 */
export type WindowType = "root" | "command_exec" | "do" | "todo" | "talk" | "program" | "file" | "knowledge" | "search" | "issue" | "relation" | "custom";

/**
 * Window 状态值汇总。
 *
 * - command_exec：open → executing → executed
 *   - 成功后系统自动从 contextWindows 移除（spec § submit 段）
 *   - 失败则保留 executed + result（错误信息），等 LLM 显式 close
 * - do：running → archived（被 close 时切到 archived，对应 B=ii archive 语义）
 * - todo：open → done（被 close 时切到 done）
 * - talk：open → closed（close 释放，与对端无关）
 * - program：open → closed（close 释放）
 * - file / knowledge：open → closed（close 释放，可触发 reload）
 * - root：仅 active；与 thread 同生命周期，不能被关闭
 */
export type WindowStatus = "open" | "executing" | "executed" | "running" | "archived" | "done" | "active" | "closed";

/**
 * 所有 ContextWindow 共享的字段。
 *
 * - id：全局唯一稳定 ID（root 固定为 "root"，其它类型用 generateWindowId）
 * - parentWindowId：command_exec 必有 parent；其它类型不显式挂 parent 时默认在 root 下
 * - title：所有 window 强制必填（spec § ContextWindow 抽象）
 * - windowKnowledgePaths：本 window 自身关联的 knowledge path（用于 close 时释放引用计数）
 */
export interface BaseContextWindow {
  id: string;
  type: WindowType;
  parentWindowId?: string;
  title: string;
  status: WindowStatus;
  createdAt: number;
  windowKnowledgePaths?: string[];
}

// ─────────────────────────── per-type interface re-exports ────────────────────

export type { RootWindow } from "../root/types.js";
export type { CommandExecWindow } from "../command_exec/types.js";
export type { DoWindow } from "../do/types.js";
export type { TodoWindow } from "../todo/types.js";
export type { TalkWindow } from "../talk/types.js";
export type { ProgramWindow, ProgramExecRecord } from "../program/types.js";
export type { FileWindow } from "../file/types.js";
export type { KnowledgeWindow } from "../knowledge/types.js";
export type { SearchWindow, SearchMatch } from "../search/types.js";
export type { IssueWindow } from "../issue/types.js";
export type { RelationWindow } from "../relation/types.js";
export type { CustomWindow } from "../custom/types.js";

// 用 import 形式拿到具体类型构造 ContextWindow union（type-only re-export 在 union 里不直接可见）
import type { RootWindow } from "../root/types.js";
import type { CommandExecWindow } from "../command_exec/types.js";
import type { DoWindow } from "../do/types.js";
import type { TodoWindow } from "../todo/types.js";
import type { TalkWindow } from "../talk/types.js";
import type { ProgramWindow } from "../program/types.js";
import type { FileWindow } from "../file/types.js";
import type { KnowledgeWindow } from "../knowledge/types.js";
import type { SearchWindow } from "../search/types.js";
import type { IssueWindow } from "../issue/types.js";
import type { RelationWindow } from "../relation/types.js";
import type { CustomWindow } from "../custom/types.js";

/** 所有 ContextWindow 类型的 discriminated union。新增 type 后必须扩这里 + WINDOW_REGISTRY。 */
export type ContextWindow =
  | RootWindow
  | CommandExecWindow
  | DoWindow
  | TodoWindow
  | TalkWindow
  | ProgramWindow
  | FileWindow
  | KnowledgeWindow
  | SearchWindow
  | IssueWindow
  | RelationWindow
  | CustomWindow;

/** Root window 的固定 id。 */
export const ROOT_WINDOW_ID = "root";

/** 生成 window id；前缀按类型区分，便于日志阅读。 */
export function generateWindowId(type: Exclude<WindowType, "root">): string {
  const prefix = ({
    command_exec: "f",
    do: "w_do",
    todo: "w_todo",
    talk: "w_talk",
    program: "w_prog",
    file: "w_file",
    knowledge: "w_kn",
    search: "w_search",
    issue: "w_issue",
    relation: "w_rel",
    custom: "w_custom",
  } as const)[type];
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 派生稳定的 creator do_window id（spec § 初始 creator 对话 window）。 */
export function creatorWindowIdOf(threadId: string): string {
  return `w_creator_${threadId}`;
}

/** 派生 custom window 的稳定 id（plan §6.4：单例 id = `custom:<objectId>`）。 */
export function customWindowIdOf(objectId: string): string {
  return `custom:${objectId}`;
}

/** root thread 的 creator 约定值（spec § 初始 creator 对话 window，root thread 无父）。 */
export const SESSION_CREATOR_THREAD_ID = "__session__";
