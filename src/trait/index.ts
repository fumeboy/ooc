/**
 * Trait 模块统一导出
 */
export { loadTrait, loadAllTraits, loadTraitsByRef, parseTSDoc } from "./loader.js";
export { MethodRegistry } from "./registry.js";
export type { MethodContext, RegisteredMethod } from "./registry.js";
export { getActiveTraits } from "./activator.js";
