/**
 * activator expr —— knowledge `activates_on` trigger 解析 + 求值（issue N 协议简化）。
 *
 * **单一 intent 维度**（issue N 裁决 5）—— 退役历史的 window:: / method:: / super:: 三 kind,
 * 协议简化为 `intent::<category>::<detail>` 三段式命名空间：
 *
 * - `intent::class::<class>` —— context 中存在该 class 的 window（每条 contextWindows ref 由其
 *   root readable.intents 产）
 * - `intent::form_open::<targetClass>::<guideName>` —— 存在 open 着的 method_exec_form 指向该
 *   class 的该 guide（由 method_exec_form.readable.intents 产）
 * - `intent::super_flow::active` —— 当前 thread 跑在 super session（由 thread.readable.intents 产）
 * - `intent::user::<name>` —— 用户 ooc class 自定义命名空间
 *
 * intent 集合本身由 `core/thinkable/context/scanIntents.ts` 在每轮 thinkloop 聚合,作为
 * `ReadableContext.intents` 注入各 readable render；本 expr 求值时只 `env.intents.has(t.name)`。
 *
 * 多 trigger 命中取 max 级别（show_content > show_description）。
 */
import type { ActivationLevel, ActivatesOn } from "./types.js";

/** 单一 intent trigger（issue N 裁决 5：协议简化为单维度）。 */
export interface Trigger {
  kind: "intent";
  /** 完整 intent 表达式（含 `intent::` 前缀去除后的部分）,如 `class::root` / `form_open::file::open`。 */
  name: string;
}

/** 解析单条 trigger 表达式；失败抛错（caller 决定是否 catch）。 */
export function parseTrigger(expr: string): Trigger {
  const s = expr.trim();
  if (s.startsWith("intent::")) {
    return { kind: "intent", name: s.slice("intent::".length).trim() };
  }
  throw new Error(`[activator.expr] unknown trigger (expected 'intent::*'): ${s}`);
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

/**
 * 求值环境 —— 描述当前思考栈的状态（issue N 简化为单 intents 集合）。
 *
 * intents 集合由 `core/thinkable/context/scanIntents.ts` 聚合,经 ReadableContext.intents 注入。
 */
export interface ActivationContext {
  intents: Set<string>;
}

/** 在求值环境下检查一条 trigger 是否命中。 */
export function evaluateTrigger(t: Trigger, env: ActivationContext): boolean {
  return env.intents.has(t.name);
}

/** 取两个级别的 max（show_content > show_description）。 */
export function maxLevel(a: ActivationLevel | undefined, b: ActivationLevel): ActivationLevel {
  if (a === "show_content" || b === "show_content") return "show_content";
  return "show_description";
}
