// interpreter builtin —— barrel。
// executable/index.ts 单处声明整个 interpreter 类（registerWindowClass：methods + readable + flag）。
export * from "./executable/index.js"; // side-effect: registerWindowClass
export type * from "./types.js";
