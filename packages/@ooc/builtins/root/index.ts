// executable/index.ts 单处声明 root 类（registerWindowClass：ROOT_METHODS + readable + flag）+ _builtin/agent agency。
export * from "./executable/index.js"; // side-effect: registerWindowClass + registerExecutable
export type * from "./types.js";
export { default as WindowDetail } from "./visible/index.js";
