// example builtin —— 标准对象定义样板（barrel）。
// executable/index.ts 注册 executable 维度并 side-effect import readable.ts；
// readable.ts 自注册 readable 维度。两者按维度分文件、分注册。
export * from "./executable/index.js";
export type * from "./types.js";
