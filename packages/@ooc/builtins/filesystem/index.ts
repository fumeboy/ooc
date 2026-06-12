// filesystem builtin —— barrel。
// readable.ts 自注册 readable 维度；executable/index.ts 注册 executable 维度（side-effect）。
import "./readable.js"; // side-effect: registerReadable
export * from "./executable/index.js"; // side-effect: registerExecutable
export type * from "./types.js";
