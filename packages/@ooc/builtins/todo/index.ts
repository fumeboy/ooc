import "./readable.js"; // side-effect: 加载 readable 维度（registerReadable）
export * from "./executable/index.js"; // side-effect: 加载 executable 维度（registerExecutable）
export type * from "./types.js";
export { default as WindowDetail } from "./visible/index.js";
