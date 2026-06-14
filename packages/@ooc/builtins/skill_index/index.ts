// executable/index.ts 单处声明整个 skill_index 类（registerWindowClass：methods + readable + onClose + flag）。
export * from "./executable/index.js"; // side-effect: registerWindowClass
export type * from "./types.js";
export { default as WindowDetail } from "./visible/index.js";
