/**
 * Object Method 相关类型 — 与 ContextWindow 抽象配套，但语义独立。
 *
 * - ObjectMethod：单个 method 的完整定义（paths / match / knowledge / exec + 可见性标记）
 * - MethodExecutionContext：method 的 exec 函数运行时入参
 * - MethodKnowledgeEntries：method.knowledge() 的返回 shape
 * - MethodOutcome：method.exec 的显式返回结果
 *
 * Object registry 中每种 type 的 `methods` map 由 ObjectMethod 字典构成。
 *
 * 历史：本文件由 src/executable/commands/types.ts 移到 windows/ 目录下，体现
 * "method 是 object 的能力" 这一从属关系。2026-05-28 ooc-6 Object Unification
 * 把命名统一改为 method/object，旧 command/window 名称保留为 @deprecated alias。
 */

import type { ThreadContext } from "../../../thinkable/context";
import type { CommandExecWindow, ContextWindow } from "./types";
import type { WindowManager } from "./manager";

/** Method knowledge entries（扁平结构，无嵌套子节点）。 */
export type MethodKnowledgeEntries = Record<string, string>;

/** @deprecated Use MethodKnowledgeEntries instead (2026-05-28 ooc-6 Object Unification). */
export type CommandKnowledgeEntries = MethodKnowledgeEntries;

/**
 * Method exec 的显式返回结果。
 *
 * 旧 exec 直接返回 `string | undefined`：undefined = 成功无 result；string = 多义（成功结果 / 失败 message
 * 都用 `[<name>] ...` 前缀），被 manager 用启发式识别。
 *
 * 推荐返回结构化 outcome，让 ok 与正文解耦。三种形态都被 WindowManager.submit 接受：
 * - undefined                → 成功
 * - "..."（不带 [tag] 前缀）→ 成功 + result 文本
 * - { ok: true, result }     → 成功 + result 文本（regular method 返回）
 * - { ok: true, object }     → 成功 + 构造出新 ContextWindow（constructor method 返回；P6 ooc-6）
 * - { ok: false, error }     → 失败；form 保留 status=failed 等待 LLM refine/close
 *
 * 旧路径"返回 `[<name>] ...` string 即失败"仍兼容（manager 内部识别），但新代码应改用 outcome。
 */
export type MethodOutcome =
  | { ok: true; result?: string }
  | { ok: true; object: ContextWindow }
  | { ok: false; error: string };

/** @deprecated Use MethodOutcome instead (2026-05-28 ooc-6 Object Unification). */
export type CommandExecOutcome = MethodOutcome;

/**
 * Object method 定义（合并了原 Window Command 与 Object Server Method 的概念）。
 *
 * 包含执行 / 知识 / 路径派生 / 权限等核心字段，并附 `public` / `for_ui_access` 可见性标记。
 *
 * 之前的名字是 CommandTableEntry，2026-05-28 ooc-6 Object Unification 改名为 ObjectMethod；
 * 旧名仍以 `@deprecated` alias 形式 export。
 */
export interface ObjectMethod {
  /** P6 (ooc-6): Marks this method as the constructor of the Object class.
   *  Constructor methods MUST return MethodOutcome of the form `{ ok: true, object: ContextWindow }`.
   *  Manager handles mounting (in-memory map + thread.contextWindows + persistence).
   *  Regular methods (kind undefined or "method") use the existing { ok, result?: string } form. */
  kind?: "constructor" | "method";
  /** 该 method 可能产出的所有 path 集合（用于反向索引建表 + 文档目录） */
  paths: string[];
  /**
   * 三档准入控制 (Q0b 引入; design: docs/2026-05-25-permission-model-design.md)。
   *
   * - "allow"  → 直接执行（默认；适合纯读 / 控制流 method）
   * - "ask"    → 触发 PermissionDecider HITL，写 permission_ask ProcessEvent + thread.status="paused"
   * - "deny"   → 系统直接拒绝，写 permission_denied ProcessEvent + 合成 function_call_output
   *
   * 现在是函数：args 来自 form.accumulatedArgs，可按入参派生 level（例如 write_file 命中
   * cwd 外路径才 ask）。**缺省（字段未声明）视为 "allow"**；函数抛错时也回落 "allow"。
   *
   * runtime override: stones/<self>/objects/<id>/config/policies.json 中 methods[<method>]
   * 字段可在不改源码的情况下覆盖本声明。
   *
   * 参考 meta/object.doc.ts:executable.children.permission。
   */
  permission?: (args: Record<string, unknown>) => "allow" | "ask" | "deny";
  /**
   * 给定 args，返回此次激活的 path 子集（必含 method 自身名）。多条路径并行。
   *
   * 规则：
   * - 总是包含 bare method 名（如 "talk"）
   * - 各维度（wait、context、type 等）独立决定是否追加对应 path
   * - match 抛异常时退化为只返回 bare path
   */
  match: (args: Record<string, unknown>) => string[];
  /** 基于当前参数与 form 生命周期状态派生 method 知识。 */
  knowledge?: (
    args: Record<string, unknown>,
    formStatus: CommandExecWindow["status"]
  ) => MethodKnowledgeEntries;
  /**
   * 执行该 method 的入口；WindowManager.submit 在 form 状态切到 executing 后调用。
   *
   * 返回 outcome 是首选；返回 string/undefined 兼容旧实现。详见 MethodOutcome 注释。
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
   * 是否可通过前端 HTTP API 调用（对应原 llm_methods 概念）。
   * - true: 可通过 POST /api/objects/:id/exec 调用
   * - false（默认）: 仅能被 LLM 通过 exec tool 调用
   */
  for_ui_access?: boolean;
}

/**
 * @deprecated Use ObjectMethod instead (2026-05-28 ooc-6 Object Unification).
 * CommandTableEntry was the original name; ObjectMethod is the canonical name now.
 * The alias preserves backward compatibility for one release; will be removed in §10 cleanup.
 */
export type CommandTableEntry = ObjectMethod;

/**
 * Method 执行上下文，由 WindowManager.submit 消费 form 后传入具体 method。
 *
 * 字段：
 * - thread：当前执行 method 的线程
 * - form：被 submit 消费的 form 自身（CommandExecWindow）
 * - self：method 被调用的 ContextWindow（receiver；OOP semantics）。
 *   2026-06-02 P6.§1 命名规范化：原 `parentWindow` 字段语义就是 receiver，
 *   按 OOP 习惯改名 `self`。`parentWindow` 保留为 `@deprecated` alias 同步赋值，
 *   过渡期间所有 caller 应迁移到 `ctx.self`。
 *   说明：与 `CustomCommandContext.programSelf` 不冲突——programSelf 是 Program object
 *   的类型化数据，self 是 method 的 receiver window；两者是不同维度。
 *   root method 时 self.type === "root"。
 * - parentWindow：@deprecated 同 `self`，仅为过渡期保留；移除时机见 §10 cleanup。
 * - manager：当前调度的 WindowManager；method exec 必须通过它操作 contextWindows，
 *   不要直接 mutate thread.contextWindows——否则 manager 完成 entry.exec 后调用 toData() 会覆盖
 * - args：最终参数（form.accumulatedArgs）
 */
export interface MethodExecutionContext<TSelf extends ContextWindow = ContextWindow> {
  thread?: ThreadContext;
  form?: CommandExecWindow;
  /** P6.§1 (2026-06-02): the ContextWindow receiver of this method (OOP `self`). */
  self?: TSelf;
  /** @deprecated 2026-06-02 P6.§1: use `self` instead. Manager populates both for transition. */
  parentWindow?: TSelf;
  manager?: WindowManager;
  args: Record<string, unknown>;
}

/** @deprecated Use MethodExecutionContext instead (2026-05-28 ooc-6 Object Unification). */
export type CommandExecutionContext = MethodExecutionContext;
