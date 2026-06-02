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
/** @deprecated Use ObjectType instead (2026-05-28 ooc-6 Object Unification). WindowType is being renamed to ObjectType. */
export type WindowType = "root" | "method_exec" | "command_exec" | "do" | "todo" | "talk" | "program" | "file" | "knowledge" | "search" | "relation" | "skill_index" | "feishu_chat" | "feishu_doc" | "plan" | (string & {});

/**
 * Object 类型枚举（原 WindowType 重命名，2026-05-28 ooc-6 Object Unification）。
 *
 * 注意："relation" 类型已在 Phase 6 被 peer Object 自动注入机制替代,保留仅用于向后兼容,
 * Phase 9 cleanup 时移除。新代码不应使用 "relation" 类型,peer/children Object 会自动以
 * 自身 type、objectId=<peerId> 的形式进入 context（不再经过 custom window 包装）。
 */
export type ObjectType = Exclude<WindowType, "relation">;

/**
 * Window 状态值汇总。
 *
 * - command_exec：open → executing → success | failed（Round 13 升级，旧 "executed" 已彻底删除）
 *   - 成功 (success) 后系统自动从 contextWindows 移除（spec § submit 段）
 *   - 失败 (failed) 保留 result（错误信息）；可通过 refine 回 open 重 submit（"复活"路径），
 *     或 close 彻底放弃；refine-from-failed 是首选修复路径，保留 form 上下文
 * - do：running → archived（被 close 时切到 archived，对应 B=ii archive 语义）
 * - todo：open → done（被 close 时切到 done）
 * - talk：open → closed（close 释放，与对端无关）
 * - program：open → closed（close 释放）
 * - file / knowledge：open → closed（close 释放，可触发 reload）
 * - root：仅 active；与 thread 同生命周期，不能被关闭
 */
export type WindowStatus = "open" | "executing" | "success" | "failed" | "running" | "archived" | "done" | "active" | "closed";

/**
 * 所有 ContextWindow 共享的字段。
 *
 * - id：全局唯一稳定 ID（root 固定为 "root"，其它类型用 generateWindowId）
 * - parentWindowId：command_exec 必有 parent；其它类型不显式挂 parent 时默认在 root 下
 * - title：所有 window 强制必填（spec § ContextWindow 抽象）
 * - windowKnowledgePaths：本 window 自身关联的 knowledge path（用于 close 时释放引用计数）
 * - sharing：跨 thread 共享状态；缺省 = 该 thread 独占持有（owner，可正常操作）
 *   详见 SharingState 与 do_window.move 命令（plan: do_window.move 跨 thread 共享）
 */
export interface BaseContextWindow {
  id: string;
  type: WindowType;
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
   * - 1              → folded 折叠态（title + 摘要 + expand 提示）
   * - 2              → snapshot 仅元信息
   *
   * 切档由 compress tool（B4）或后续 phase 的自然衰减 / emergency guard 触发；
   * 每次切档系统会写一条 `context_compressed` ProcessEvent（B6），落 thread.json events 流。
   *
   * 持久化策略：thread.json 写盘时 0/undefined 视为默认值,被 stripVolatileForPersist 剥离,
   * 避免在历史 thread 上增加无意义字段。
   */
  compressLevel?: 0 | 1 | 2;
  /**
   * 自然衰减元数据（design: docs/2026-05-25-context-compression-design.md §4.3,
   * meta/object.doc.ts:thinkable.children.context_budget.patches.natural_decay）。
   *
   * 由 src/thinkable/context/budget.ts 的 applyNaturalDecay 维护：
   * - idleRounds:        window.status ∈ idle-set 持续轮数（连续命中 idle 状态的计数器）
   * - sinceExecRounds:   自上次被 LLM 通过 exec/close 等操作起,未被访问的轮数
   * - level1Rounds:      compressLevel=1 状态持续轮数（用于 double-fold）
   * - lastSeenEventIdx:  上一轮 applyNaturalDecay 看过的 thread.events.length；用于增量扫描
   *
   * **持久化策略**：下划线前缀属于运行时辅助字段，**不应**进 thread.json；
   * 由 stripVolatileForPersist 剥离（见 src/persistable/thread-json.ts）。
   * 缺省 / undefined 时 applyNaturalDecay 会把它当 0 处理。
   */
  _decayMeta?: {
    idleRounds: number;
    sinceExecRounds: number;
    level1Rounds: number;
    lastSeenEventIdx: number;
  };
}

/**
 * 跨 thread 共享 ContextWindow 的状态（plan §sharing）。
 *
 * - kind="ref"：我（当前 thread）持有的是只读 ref；snapshot 是分享时刻的 freeze。
 *   owner 在 ownerThreadId 所在的 thread 那边继续 live；我看到的内容不会随 owner 改动而更新。
 *   ref 上不能 exec 任何命令（除 close 释放本地引用）。
 * - kind="lent_out"：我曾是 owner，已把 owner 移交给 borrowerThreadId；当前我自己看到的是
 *   分享时刻的 snapshot，临时只读。borrower thread 结束/归还时，我恢复 owner 状态。
 *
 * window 跨 thread move 时 id 严格保持不变（用 id 做 lent_out ↔ owner 的配对识别归还）。
 */
export type SharingState =
  | {
      kind: "ref";
      /** 真 owner 所在 thread。 */
      ownerThreadId: string;
      /** 把这个 ref 引进来的 do_window.id（对端 do_window；用于 UI 反查"由哪个 do 进来的"）。 */
      lentByWindowId: string;
      /** 分享时刻 timestamp（ms）。 */
      sharedAt: number;
      /** 不带 sharing 字段的 freeze 副本；render / 渲染 knowledge 时使用。 */
      snapshot: ContextWindow;
    }
  | {
      kind: "lent_out";
      /** 借给谁。 */
      borrowerThreadId: string;
      /** 自己持有的指向 borrower 的 do_window.id（用于 UI 反查"借给哪个 do"）。 */
      lentToWindowId: string;
      /** 分享时刻 timestamp（ms）。 */
      sharedAt: number;
      /** 借出时刻的 freeze 副本；render 时自己用（自己看不到 latest，因为 latest 在 borrower 那边）。 */
      snapshot: ContextWindow;
    };

// ─────────────────────────── per-type interface re-exports ────────────────────

export type { RootWindow } from "@ooc/builtins/root/types.js";
export type { CommandExecWindow } from "../method_exec/types.js";
// P6.§9 (2026-06-02): canonical alias under the new "method_exec" type name.
//                     CommandExecWindow remains as the structural type (one release alias).
export type { MethodExecWindow } from "../method_exec/types.js";
export type { DoWindow } from "../do/types.js";
export type { TodoWindow } from "@ooc/builtins/todo/types.js";
export type { TalkWindow } from "../talk/types.js";
export type { ProgramWindow, ProgramExecRecord } from "@ooc/builtins/program/types.js";
export type { FileWindow } from "@ooc/builtins/file/types.js";
export type { KnowledgeWindow } from "@ooc/builtins/knowledge/types.js";
export type { SearchWindow, SearchMatch } from "@ooc/builtins/search/types.js";
/** @deprecated ooc-6: RelationWindow replaced by peer Object auto-injection (derivePeerObjectWindows). Kept for backward compat with persisted thread data; Phase 9 cleanup will remove. */
export type { RelationWindow } from "../relation/types.js";
export type { SkillIndexWindow, SkillEntry } from "@ooc/builtins/skill_index/types.js";
export type { PlanWindow, PlanWindowStep } from "@ooc/builtins/plan/types.js";
export type { FeishuChatWindow, FeishuChatMessage } from "../../../extendable/lark/feishu-chat/types.js";
export type { FeishuDocWindow, FeishuDocBlock } from "../../../extendable/lark/feishu-doc/types.js";

// 用 import 形式拿到具体类型构造 ContextWindow union（type-only re-export 在 union 里不直接可见）
import type { RootWindow } from "@ooc/builtins/root/types.js";
import type { CommandExecWindow } from "../method_exec/types.js";
import type { DoWindow } from "../do/types.js";
import type { TodoWindow } from "@ooc/builtins/todo/types.js";
import type { TalkWindow } from "../talk/types.js";
import type { ProgramWindow } from "@ooc/builtins/program/types.js";
import type { FileWindow } from "@ooc/builtins/file/types.js";
import type { KnowledgeWindow } from "@ooc/builtins/knowledge/types.js";
import type { SearchWindow } from "@ooc/builtins/search/types.js";
/** @deprecated ooc-6: RelationWindow replaced by peer Object auto-injection. Kept for backward compat. */
import type { RelationWindow } from "../relation/types.js";
import type { SkillIndexWindow } from "@ooc/builtins/skill_index/types.js";
import type { PlanWindow } from "@ooc/builtins/plan/types.js";
import type { FeishuChatWindow } from "../../../extendable/lark/feishu-chat/types.js";
import type { FeishuDocWindow } from "../../../extendable/lark/feishu-doc/types.js";

/** 所有 ContextWindow 类型的 discriminated union。新增 type 后必须扩这里 + WINDOW_REGISTRY。 */
/** @deprecated Use ContextObject instead (2026-05-28 ooc-6 Object Unification). ContextWindow is being renamed to ContextObject. */
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
  /** @deprecated ooc-6: replaced by peer Object auto-injection; kept for backward compat */
  | RelationWindow
  | SkillIndexWindow
  | FeishuChatWindow
  | FeishuDocWindow
  | PlanWindow;

/**
 * ContextObject 类型的 discriminated union（原 ContextWindow 重命名，2026-05-28 ooc-6）。
 * 与 ContextWindow 完全等价，仅语义上强调"这是 Object 在 context 中的形态"。
 */
export type ContextObject = ContextWindow;

/** Root window 的固定 id。 */
export const ROOT_WINDOW_ID = "root";

/** Skill 索引 window 的固定 id（每个 thread 唯一一份；plan §skills 支持）。 */
export const SKILL_INDEX_WINDOW_ID = "skill_index";

/** 生成 window id；前缀按类型区分，便于日志阅读。 */
export function generateWindowId(type: Exclude<WindowType, "root">): string {
  const prefixMap: Record<string, string> = {
    command_exec: "f",
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

/** 派生稳定的 creator do_window id（spec § 初始 creator 对话 window）。 */
export function creatorWindowIdOf(threadId: string): string {
  return `w_creator_${threadId}`;
}

/** root thread 的 creator 约定值（spec § 初始 creator 对话 window，root thread 无父）。 */
export const SESSION_CREATOR_THREAD_ID = "__session__";
