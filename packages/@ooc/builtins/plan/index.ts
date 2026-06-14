// executable/index.ts 单处声明整个 plan 类（registerWindowClass：methods + readable + compressView + onClose + flag）。
export * from "./executable/index.js"; // side-effect: registerWindowClass
export type * from "./types.js";
export { default as WindowDetail } from "./visible/index.js";
