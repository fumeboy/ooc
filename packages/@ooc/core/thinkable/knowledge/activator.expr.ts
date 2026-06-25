/**
 * activator.expr —— knowledge `activates_on` trigger 解析 + 求值。
 *
 * 三类 trigger 语法：
 * - `window::<class>` —— context 中存在某 class 的 window
 * - `method::<class>::<method>` —— 存在挂该 class 上的 method_exec form 窗（method 名）
 * - `super` / `super::<true>` —— 当前 thread 跑在 super session
 *
 * 多 trigger 命中取 max 级别（show_content > show_description）。
 */
import type { ActivationLevel, ActivatesOn } from "../../types/knowledge.js";

export type Trigger =
  | { kind: "window"; class: string }
  | { kind: "method"; class: string; method: string }
  | { kind: "super" };

/** 解析单条 trigger 表达式；失败抛错（caller 决定是否 catch）。 */
export function parseTrigger(expr: string): Trigger {
  const s = expr.trim();
  if (s === "super") return { kind: "super" };
  if (s.startsWith("window::")) {
    return { kind: "window", class: s.slice("window::".length).trim() };
  }
  if (s.startsWith("method::")) {
    const rest = s.slice("method::".length);
    const idx = rest.indexOf("::");
    if (idx < 0) throw new Error(`[activator.expr] method trigger missing method name: ${s}`);
    return { kind: "method", class: rest.slice(0, idx).trim(), method: rest.slice(idx + 2).trim() };
  }
  throw new Error(`[activator.expr] unknown trigger: ${s}`);
}

/** 解析整个 activates_on map；失败的 entry 跳过 + 警告（caller 不阻塞激活）。 */
export function parseActivatesOn(raw: unknown, file?: string): Map<Trigger, ActivationLevel> {
  const out = new Map<Trigger, ActivationLevel>();
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as ActivatesOn)) {
    if (v !== "show_description" && v !== "show_content") continue;
    try {
      out.set(parseTrigger(k), v);
    } catch (e) {
      console.warn(`[activator.expr] parse failed (${file ?? "?"}): ${(e as Error).message}`);
    }
  }
  return out;
}

/** 求值环境 —— 描述当前思考栈的状态。 */
export interface ActivationContext {
  /** context 中所有 window 的 class 集合。 */
  windowClasses: Set<string>;
  /** method_exec form 中的 (class, method) 对集合。 */
  methodForms: Set<string>; // "class::method" 格式
  /** 是否 super session。 */
  inSuper: boolean;
}

/** 在求值环境下检查一条 trigger 是否命中。 */
export function evaluateTrigger(t: Trigger, env: ActivationContext): boolean {
  switch (t.kind) {
    case "super":
      return env.inSuper;
    case "window":
      return env.windowClasses.has(t.class);
    case "method":
      return env.methodForms.has(`${t.class}::${t.method}`);
  }
}

/** 取两个级别的 max（show_content > show_description）。 */
export function maxLevel(a: ActivationLevel | undefined, b: ActivationLevel): ActivationLevel {
  if (a === "show_content" || b === "show_content") return "show_content";
  return "show_description";
}
