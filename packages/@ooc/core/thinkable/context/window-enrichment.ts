/**
 * Window enrichment utilities.
 *
 * Wave 4：effectiveVisibleType（沿 parentClass 链解析「有效可见渲染类型」）随可见性短路
 * 一并丢弃——registry 不再提供 resolveEffectiveVisibleType。本函数降为类型对齐的 pass-through，
 * 保留 pipeline 相位占位以便后续 re-home 可见性时填回。
 */
import type { OocObjectInstance } from "../../runtime/ooc-class.js";
import type { ObjectRegistry } from "../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../executable/windows/index.js";

/** Pass-through over context windows（effectiveVisibleType 解析本轮丢弃）。 */
export function enrichContextWindows(
  windows: OocObjectInstance[] | undefined,
  _registry: ObjectRegistry = builtinRegistry,
): OocObjectInstance[] {
  return windows ?? [];
}
