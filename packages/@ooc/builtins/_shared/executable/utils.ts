/**
 * Shared low-level helpers for builtin object methods.
 *
 * Batch B2 (2026-06-04): extracted the byte-identical micro-helpers that were
 * copy-pasted across builtins/{root,plan,file,knowledge,...}/executable/:
 *
 * - `isString(v)`      — typeof narrowing guard (3 local copies).
 * - `basenameOfPath(p)`— last path segment, "/" or "\\" separated (2 copies).
 * - `emptyIntent`      — the `intent: () => []` no-sub-intent default that
 *                        appeared 31× inline; hoisting it gives one shared
 *                        reference and a single typed contract.
 *
 * Kept deliberately tiny and dependency-light: only `Intent` is imported so
 * `emptyIntent` matches `ObjectMethod.intent`'s signature.
 */

import type { Intent } from "@ooc/core/thinkable/context/intent.js";

/** typeof 字符串守卫——窄化 `unknown` 到 `string`。 */
export function isString(v: unknown): v is string {
  return typeof v === "string";
}

/** 取路径最后一段（按 "/" 或 "\\" 分隔）；无分隔符则原样返回。 */
export function basenameOfPath(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/**
 * `ObjectMethod.intent` 的默认实现——method 没有子 intent 消歧时用它。
 * 共享单一引用，替代散落各处的 `intent: () => []` / `intent: (): Intent[] => []`。
 */
export const emptyIntent = (): Intent[] => [];
