/**
 * WindowMethod —— 控制 window 展示（viewport 等）的方法，归 readable 维度。
 *
 * 与 ObjectMethod（控制 object 业务数据，归 executable）函数签名不同：exec 额外接收
 * `windowState`（当前 window 展示状态快照），返回新 WindowDisplayState 而非原地 mutate。
 * 协作闭环：windowMethod 写 state → 持久化 thread-context → readable 读 state 构造输出。
 *
 * 设计来源：docs/2026-06-08-window-visible-render-and-readable-window-method-design.md Part 2。
 */
import type { MethodExecutionContext, MethodExecuteForm } from "./method.js";
import type { ContextWindow } from "./context-window.js";
import type { Intent, FormChangeEvent, MethodCallSchema } from "./intent.js";
import type { WindowDisplayState } from "./window-state.js";

/**
 * WindowMethod 执行上下文 —— 在 ObjectMethod 入参基础上额外接收 window 展示状态对象。
 * 这是 WindowMethod 与 ObjectMethod 的签名差异点。
 */
export interface WindowMethodExecutionContext extends MethodExecutionContext {
  /** 当前 window 展示状态（只读快照）；method 据此计算新 state 返回。 */
  windowState: WindowDisplayState;
}

/** WindowMethod.exec 的返回结果：成功必带新 state（immutable，由 manager 写回 window.state）。 */
export type WindowMethodOutcome =
  | { ok: true; state: WindowDisplayState; result?: string }
  | { ok: false; error: string };

/**
 * Window method 定义 —— 控制 window 展示（viewport 等），归 readable 维度。
 * 与 ObjectMethod（控制 object 业务数据，归 executable）物理分离、函数签名不同。
 *
 * 2026-06-10: 同步 ObjectMethod API 重构 —— 新增 description、paths→intents、
 * intent() 合并到 onFormChange 返回 MethodExecuteForm。
 */
export interface WindowMethod {
  kind?: "window";
  /** LLM-facing short description. Required. */
  description: string;
  /** Static catalog of sub-intent names; optional. */
  intents?: string[];
  permission?: (args: Record<string, unknown>) => "allow" | "ask" | "deny";
  /**
   * Called on form lifecycle / args changes. Returns MethodExecuteForm (tip + intents + quick_exec_submit).
   * If omitted, no form is created and exec fires directly.
   * ctx.args = form 当前累积参数，与 ObjectMethod.onFormChange 对齐。
   */
  onFormChange?(
    change: FormChangeEvent,
    ctx: { args: Record<string, unknown> },
  ): MethodExecuteForm;
  schema?: MethodCallSchema;
  /** 不同于 ObjectMethod.exec：额外接收 ctx.windowState，返回新 state。 */
  exec: (
    ctx: WindowMethodExecutionContext,
  ) => WindowMethodOutcome | Promise<WindowMethodOutcome>;
  /** 是否对其他 Object 可见并可调用（peer 档过滤）。 */
  public?: boolean;
  /** 是否可通过前端 HTTP API 调用（ui 档过滤）。 */
  for_ui_access?: boolean;
}
