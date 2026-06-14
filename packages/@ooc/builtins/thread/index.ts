// thread builtin class —— barrel。
// executable/index.ts 单处声明整个 thread 类（registerWindowClass：无 constructor + readable + flag）。
export * from "./executable/index.js"; // side-effect: registerWindowClass
export type * from "./types.js";
