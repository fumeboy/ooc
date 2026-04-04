/**
 * Trait 模块统一导出
 */
export { loadTrait, loadAllTraits, loadTraitsByRef, loadTraitsFromDir, buildTraitTree, parseTSDoc } from "./loader.js";
export { MethodRegistry } from "./registry.js";
export type { MethodContext, RegisteredMethod } from "./registry.js";
export { getActiveTraits, getChildTraits } from "./activator.js";
