/**
 * core/types —— 纯契约层 re-export。
 *
 * 任何模块 `import type { Foo } from "@ooc/core/types"`，不要直接深入子文件
 * （除非确实只要其中一两个符号）。
 */
export * from "./executable.js";
export * from "./readable.js";
export * from "./persistable.js";
export * from "./visible-server.js";
export * from "./thinkable.js";
export * from "./intent.js";
export * from "./knowledge.js";
export * from "./self-proxy.js";
export * from "./xml.js";
export * from "./permissions.js";
export * from "./context-window.js";
export * from "./constants.js";
export * from "./paths.js";
