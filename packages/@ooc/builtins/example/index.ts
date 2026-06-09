// example builtin —— 标准对象定义样板（barrel）。
// barrel 同时加载两个维度：readable.ts 自注册 readable 维度，executable/index.ts 注册 executable 维度。
import "./readable.js"; // side-effect: 加载 readable 维度（registerReadable）
export * from "./executable/index.js"; // side-effect: 加载 executable 维度（registerExecutable）
export type * from "./types.js";
