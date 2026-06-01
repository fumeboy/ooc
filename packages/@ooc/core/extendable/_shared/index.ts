/**
 * src/extendable/_shared/ — 共享类型与注册表（2026-05-28 ooc-6 Object Unification）。
 *
 * Phase 1 迁移：本目录当前是 re-export，canonical source 在 src/executable/windows/_shared/。
 * Phase 4 起，各 builtin object 会逐个迁移到 @ooc/builtins/<type>/ 目录结构。
 */

export * from "./types";
export * from "./command-types";
export * from "./registry";
export * from "./manager";
export * from "./init";
export * from "./session-path";
export * from "./super-constants";
export * from "./transcript-viewport";
export * from "./viewport";
