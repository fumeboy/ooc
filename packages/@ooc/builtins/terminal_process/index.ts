// terminal_process builtin class —— barrel。
// executable/index.ts 单处声明整个 terminal_process 类（registerWindowClass）。
export * from "./executable/index.js"; // side-effect: registerWindowClass
export type * from "./types.js";
export { default as WindowDetail } from "./visible/index.js";
