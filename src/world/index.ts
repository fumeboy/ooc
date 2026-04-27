/**
 * World 模块统一导出
 *
 * 2026-04-21 旧 Flow 架构退役：删除 Session / createCollaborationAPI / Routable / CollaborationAPI。
 * 这些类型在线程树架构下由 collaborable/talk/collaboration.ts 内部替代，不再对外暴露。
 */
export { World } from "./world.js";
export type { WorldConfig } from "./world.js";
export { Registry } from "./registry.js";
