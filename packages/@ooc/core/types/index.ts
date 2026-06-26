/**
 * core/types —— 纯契约层 re-export。
 *
 * 任何模块 `import type { Foo } from "@ooc/core/types"`，不要直接深入子文件
 * （除非确实只要其中一两个符号）。
 *
 * **issue N**: knowledge.ts 已迁出至 `@ooc/builtins/knowledge_base/activator/types.ts`
 * （knowledge 激活机制整套下沉 builtins）。
 */
export * from "./executable.js";
export * from "./readable.js";
export * from "./persistable.js";
export * from "./visible-server.js";
export * from "./thinkable.js";
export * from "./intent.js";
export * from "./self-proxy.js";
export * from "./xml.js";
export * from "./permissions.js";
export * from "./context-window.js";
export * from "./constants.js";
export * from "./paths.js";
