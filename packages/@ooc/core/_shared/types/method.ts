/**
 * Object Method 相关类型 —— canonical 源（batch C7 从
 * `executable/windows/_shared/method-types.ts` 迁入）。
 *
 * - ObjectMethod：单个 method 的完整定义（description / intents / schema / exec + 可见性标记）
 * - MethodExecutionContext：method 的 exec 函数运行时入参
 * - MethodKnowledgeEntries：method.knowledge() 的返回 shape
 * - MethodOutcome：method.exec 的显式返回结果
 * - MethodExecuteForm：onFormChange 返回的结构化 form 状态（tip + intents + quick_exec_submit）
 *
 * **零依赖层替换（batch C7 关键决策）**：原文件引用的 executable/thinkable 具体类型在此
 * 用 `_shared` 内的中立类型替代——
 * - `MethodExecWindow`（具体 form window）→ base `ContextWindow`（discriminant narrowing 留 runtime 层）
 * - `WindowManager`（含大量 runtime 逻辑）→ `unknown`（executable 层 cast 回具体类型）
 * - `ThreadContext` / `FlowObjectRef` / `ThreadPersistenceRef` → `_shared/types/thread`
 * - `Intent` / `FormChangeEvent` / `MethodCallSchema` → `_shared/types/intent`
 */

import type { ContextWindow } from "./context-window.js";
import type { ThreadContext, FlowObjectRef, ThreadPersistenceRef } from "./thread.js";
import type { Intent, FormChangeEvent, MethodCallSchema } from "./intent.js";

/** Method knowledge entries（扁平结构，无嵌套子节点）。 */
export type MethodKnowledgeEntries = Record<string, string>;

/**
 * Structured return value of onFormChange.
 *
 * - tip: plain string shown directly on the form (replaces the retired form-bound guidance windows)
 * - intents: dynamic intent list for the current args (replaces the old intent(args) function)
 * - quick_exec_submit: when true, the runtime auto-submits the form after this refine (args sufficient)
 */
export interface MethodExecuteForm {
  tip?: string;
  intents: Intent[];
  quick_exec_submit?: boolean;
}

/**
 * Method exec 的显式返回结果。
 *
 * 三种形态都被 WindowManager.submit 接受：
 * - undefined                → 成功
 * - "..."（不带 [tag] 前缀）→ 成功 + result 文本
 * - { ok: true, result }     → 成功 + result 文本
 * - { ok: true, window }     → 成功 + 构造出新 ContextWindow（constructor method 返回，runtime 会 mount）
 * - { ok: false, error }     → 失败
 */
export type MethodOutcome =
  | { ok: true; result?: string }
  | { ok: true; window?: ContextWindow }
  | { ok: false; error: string };

/**
 * Object method 定义。
 *
 * 包含执行 / 表单 / 路径派生 / 权限等核心字段，并附 `public` / `for_ui_access` 可见性标记。
 *
 * 2026-06-10 ooc-6 ObjectMethod API 重构：
 * - 新增 required `description`（LLM 面向的方法描述）
 * - `paths` 重命名为 `intents?`（静态 sub-intent 目录，仅用于反向索引/文档）
 * - 删除 `intent(args)`；动态 intents 改由 `onFormChange` 返回的 `MethodExecuteForm.intents` 提供
 * - `onFormChange` 返回 `MethodExecuteForm`（tip 字符串 + intents + quick_exec_submit），不再返回 guidance windows
 * - 未声明 `onFormChange` 的 method 直接 exec，不创建 form
 */
export interface ObjectMethod {
  /** P6 (ooc-6): Marks this method as the constructor of the Object class.
   *  Constructor methods SHOULD return MethodOutcome of the form `{ ok: true, window: ContextWindow }`. */
  kind?: "constructor" | "method";
  /** LLM-facing short description of what this method does. Required. */
  description: string;
  /**
   * Static catalog of sub-intent names this method can answer. Used for reverse-index / docs only.
   * Runtime intents come from onFormChange's returned `MethodExecuteForm.intents`.
   * Optional — simple methods with no sub-intents omit it.
   */
  intents?: string[];
  /**
   * 三档准入控制。
   * - "allow"  → 直接执行（默认）
   * - "ask"    → 触发 PermissionDecider HITL
   * - "deny"   → 系统直接拒绝
   */
  permission?: (args: Record<string, unknown>) => "allow" | "ask" | "deny";
  /**
   * Called when the form meaningfully changes (opened, args refined, status changed).
   * Returns a structured MethodExecuteForm:
   *   - tip: plain string shown directly on the form (replaces guidance-window machinery)
   *   - intents: dynamic sub-intents for the current args
   *   - quick_exec_submit: when true, runtime auto-submits after this change
   *
   * If a method does NOT declare onFormChange, the system skips form creation entirely
   * and fires exec directly when the method is called.
   *
   * batch C7: `ctx.form` 在零依赖层退化为 base `ContextWindow`；需要 MethodExecWindow
   * 具体字段的 method 在 runtime 层自行 narrow。
   */
  onFormChange?(
    change: FormChangeEvent,
    ctx: { form: ContextWindow; intents: Intent[] },
  ): MethodExecuteForm;
  /** Optional parameter schema for structured rendering and fail-soft validation. */
  schema?: MethodCallSchema;
  /**
   * 执行该 method 的入口；WindowManager.submit 在 form 状态切到 executing 后调用。
   * For methods without onFormChange, called directly without creating a form.
   */
  exec: (
    ctx: MethodExecutionContext,
  ) =>
    | Promise<string | undefined | MethodOutcome>
    | string
    | undefined
    | MethodOutcome;
  /**
   * 是否对其他 Object 可见并可调用。
   * - true: 该方法在其他 Object 的 context 中展示，可被 exec 调用
   * - false（默认）: 仅在 Object 自己的 context 中展示
   */
  public?: boolean;
  /**
   * 是否可通过前端 HTTP API 调用。
   * - true: 可通过 POST /api/objects/:id/exec 调用
   * - false（默认）: 仅能被 LLM 通过 exec tool 调用
   */
  for_ui_access?: boolean;
}

/**
 * Method 执行上下文，由 WindowManager.submit 消费 form 后传入具体 method。
 *
 * 字段：
 * - thread：当前执行 method 的线程
 * - form：被 submit 消费的 form 自身（base ContextWindow；runtime 层 narrow 到 MethodExecWindow）
 * - self：method 被调用的 ContextWindow（receiver；OOP semantics）
 * - manager：当前调度的 WindowManager —— 零依赖层声明为 `unknown`，executable 层定义带
 *   具体 WindowManager 类型的 subtype（见 executable/windows/_shared/method-types.ts）
 * - args：最终参数（form.accumulatedArgs，或直接调用时的入参）
 */
export interface MethodExecutionContext<TSelf extends ContextWindow = ContextWindow> {
  thread?: ThreadContext;
  form?: ContextWindow;
  /** The ContextWindow receiver of this method (OOP `self`). */
  self?: TSelf;
  /** batch C7: WindowManager 含大量 runtime 逻辑，零依赖层声明为 unknown；executable 层 cast。 */
  manager?: unknown;
  args: Record<string, unknown>;
  /**
   * P6.§8 (2026-06-02): Set when the method runs on an independent flow object.
   */
  ownerFlowObjectRef?: FlowObjectRef;
  /**
   * P6.§8 (2026-06-02): Set whenever the method runs in a real persisted thread.
   */
  ownerThreadRef?: ThreadPersistenceRef;
  reportStateEdit?: () => Promise<void>;
  reportContextEdit?: () => Promise<void>;
}
