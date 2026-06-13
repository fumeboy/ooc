// terminal builtin —— barrel。
import "./readable.js"; // side-effect: registerReadable
export * from "./executable/index.js"; // side-effect: registerExecutable
export type * from "./types.js";
