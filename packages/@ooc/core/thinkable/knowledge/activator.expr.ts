/**
 * activator.expr —— knowledge `activates_on` trigger 解析 + 求值。
 *
 * 四类 trigger 语法：
 * - `window::<view>` —— context 中存在某 window view 的窗（trigger 关键字 `window::` 与 view 名拼写
 *   均不变；只是 ctx 字段名从历史的 windowClasses 改为 windowViews 与 issue J 术语一致）
 * - `method::<class>::<guide>` —— 存在挂该 class 上的 method_exec form 窗（按 guide 名匹配）
 *   注：trigger 关键字保留 `method::` 历史拼写,但语义已迁至 ObjectGuideMethod——`<guide>` 写
 *   guide method name（不再有"method 自带 route"概念）。
 * - `intent::<name>` —— 当前 thread 的 form 集合内某 form `currentIntents` 含此 intent
 *   名（动态意图驱动）；phase-1 简化：所有 form 的 currentIntents 合并为 activeIntents 求值,
 *   phase-2 再做 source-key 分组撤销机制
 * - `super` / `super::<true>` —— 当前 thread 跑在 super session
 *
 * 多 trigger 命中取 max 级别（show_content > show_description）。
 */
import type { ActivationLevel, ActivatesOn } from "../../types/knowledge.js";

export type Trigger =
  | { kind: "window"; view: string }
  | { kind: "method"; class: string; method: string }
  | { kind: "intent"; name: string }
  | { kind: "super" };

/** 解析单条 trigger 表达式；失败抛错（caller 决定是否 catch）。 */
export function parseTrigger(expr: string): Trigger {
  const s = expr.trim();
  if (s === "super") return { kind: "super" };
  if (s.startsWith("window::")) {
    return { kind: "window", view: s.slice("window::".length).trim() };
  }
  if (s.startsWith("method::")) {
    const rest = s.slice("method::".length);
    const idx = rest.indexOf("::");
    if (idx < 0) throw new Error(`[activator.expr] method trigger missing method name: ${s}`);
    return { kind: "method", class: rest.slice(0, idx).trim(), method: rest.slice(idx + 2).trim() };
  }
  if (s.startsWith("intent::")) {
    return { kind: "intent", name: s.slice("intent::".length).trim() };
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
  /** context 中所有 window 的 view 集合（按 issue J:投影视角而非对象 class id）。 */
  windowViews: Set<string>;
  /** method_exec form 中的 (目标 class, guide name) 对集合,格式 `class::guide`。 */
  methodForms: Set<string>;
  /**
   * 当前 thread 内所有 form 的 `currentIntents` 合并集合（phase-1 简化的 source-key 模型——所有
   * form 共享一个活跃 intents 集；phase-2 再做按 source-key 分组撤销）。
   */
  activeIntents: Set<string>;
  /** 是否 super session。 */
  inSuper: boolean;
}

/** 在求值环境下检查一条 trigger 是否命中。 */
export function evaluateTrigger(t: Trigger, env: ActivationContext): boolean {
  switch (t.kind) {
    case "super":
      return env.inSuper;
    case "window":
      return env.windowViews.has(t.view);
    case "method":
      return env.methodForms.has(`${t.class}::${t.method}`);
    case "intent":
      return env.activeIntents.has(t.name);
  }
}

/** 取两个级别的 max（show_content > show_description）。 */
export function maxLevel(a: ActivationLevel | undefined, b: ActivationLevel): ActivationLevel {
  if (a === "show_content" || b === "show_content") return "show_content";
  return "show_description";
}
