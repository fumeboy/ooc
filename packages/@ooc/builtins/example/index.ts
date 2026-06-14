// example builtin —— 标准对象定义样板（barrel）。
// executable/index.ts 单处声明整个 example 类（registerWindowClass：两维度一处合一 + readable from ../readable.ts）。
export * from "./executable/index.js"; // side-effect: registerWindowClass
export type * from "./types.js";
