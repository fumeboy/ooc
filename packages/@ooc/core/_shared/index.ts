/**
 * `@ooc/core/_shared` — 中立共享类型层（ooc-6）。
 *
 * 我是谁：所有"跨包被引用的纯类型 + 无副作用纯函数"的 canonical 源。终结
 * `thinkable` ↔ `executable` 的类型反向耦合——五个一级子包（thinkable /
 * executable / persistable / runtime / extendable）与 builtins/* 均**单向**
 * import 本包。
 *
 * 硬约束（违反即破坏分层）：
 * - 不 import 任何 `@ooc/core/{thinkable,executable,persistable,runtime,extendable}`
 * - 不 import 任何 `@ooc/builtins/*` 或 npm 包（react/elysia/bun runtime API）
 * - 不 IO：禁 `node:fs`；`process.cwd()` 之类全局状态读取留在调用方
 * - 只放 interface / type / 无状态常量 / 纯函数
 *
 * barrel：每加一个 types/utils 文件就在此 re-export。
 */

export * from "./types/constants.js";
export * from "./types/viewport.js";
export * from "./types/xml.js";
export * from "./types/intent.js";
export * from "./types/knowledge.js";
export * from "./types/context-window.js";
export * from "./types/thread.js";
export * from "./types/method.js";
export * from "./types/registry.js";
export * from "./utils/mention.js";
export * from "./utils/csv.js";
export * from "./utils/session-path.js";
