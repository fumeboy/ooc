/**
 * thinkable 模块解析入口 —— core thinkloop / scheduler 经此拿到运行 thread 的 class 的
 * thinkable 实现，**不再静态 import thread builtin**（解耦的关键间接层）。
 *
 * 所有跑 thinkloop 的线程都是 thread 类（THREAD_CLASS_ID）；故按常量解析。
 * **无注册 fail-loud 抛错**——不是优雅降级：一条线程没有 thinkable 模块就无法构造 context、
 * 无法 think，silent no-op 会产生难追的「LLM 收到空输入」失败且违反 silent-swallow 禁令。
 *
 * 设计权威：`docs/issues/2026-06-23-thinkable-module-context-decoupling.md` 裁决 #2。
 */
import { builtinRegistry } from "../runtime/object-registry.js";
import { THREAD_CLASS_ID } from "../_shared/types/constants.js";
import type { ThreadContext } from "../_shared/types/thread.js";
import type { ThinkableModule } from "./contract.js";

/**
 * 解析一条运行 thread 的 thinkable 模块（fail-loud）。
 * @param thread 用于错误信息定位（解析按 THREAD_CLASS_ID 常量——所有 thinkloop 线程皆此类）。
 */
export function thinkableOf(thread: ThreadContext): ThinkableModule {
  const m = builtinRegistry.resolveThinkable(THREAD_CLASS_ID);
  if (!m) {
    throw new Error(
      `[thinkable] no thinkable module registered for class "${THREAD_CLASS_ID}" ` +
        `(thread ${thread.id}); thread builtin must register Class.thinkable.`,
    );
  }
  return m;
}
