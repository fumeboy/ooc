// executable/index.ts 单处声明整个 pr 类（registerWindowClass：methods + readable + onClose + flag）。
export * from "./executable/index.js"; // side-effect: registerWindowClass
export type * from "./types.js";
// 沉淀编排 + 投递：被 reflect_request finalizer / HTTP approve 端点复用。
export * from "./approval-flow.js";
export * from "./delivery.js";
