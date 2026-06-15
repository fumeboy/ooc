/**
 * user —— 真人用户的占位 object（kind=object，非 class）。
 *
 * 无 executable / construct / readable module（身份/对话经 talk 渲染，readable.md 文字身份）。
 * 仅导出 Data 类型 + visible 维度的前端窗组件。
 */
export type * from "./types.js";
export { default as WindowDetail } from "./visible/index.js";
