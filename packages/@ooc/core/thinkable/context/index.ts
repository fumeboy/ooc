/**
 * core/thinkable/context —— thinkloop 构造 LLM input 上下文所需的协议层算子（issue N）。
 *
 * 当前只暴露 `scanIntents` —— 从 thread.contextWindows 聚合 intents。
 */
export { scanIntents } from "./scanIntents.js";
