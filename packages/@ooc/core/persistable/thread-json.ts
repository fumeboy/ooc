/**
 * thread.json 的 **path 原语 + 对外 API（薄壳 dispatch）**——core 框架，不含 thread 序列化逻辑。
 *
 * `writeThread`/`readThread` 是 core 暴露给 runtime 引擎（thinkloop/scheduler/worker/resume/
 * service）的稳定 API；它们经 registry 解析出 thread builtin 的 `persistable.container` 并**委托**。
 * thread 怎么落盘（thread.json strip 规则 / thread-context inline 嵌入 vs `_ref` / inbox /
 * hydrate）是 **thread builtin 的逻辑**（`@ooc/builtins/agent/thread/persistable/thread-container.ts`），
 * 不在 core——core 只提供框架与 API（object-model 核心 7 + persistable「core=框架+API」边界）。
 */
import { join } from "node:path";
import { threadDir, type FlowObjectRef, type ThreadPersistenceRef } from "./common.js";
import type { ThreadContext } from "../thinkable/context.js";
import type { ObjectRegistry } from "../runtime/object-registry.js";
import { builtinRegistry } from "../runtime/object-registry.js";
import { THREAD_CLASS_ID } from "../_shared/types/constants.js";

/** 单个线程的 `thread.json` 绝对路径（path 原语，框架）。 */
export function threadFile(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "thread.json");
}

/** 解析 thread builtin 的容器持久化能力（registry dispatch）；未注册则 fail-loud。 */
function resolveThreadContainer(registry: ObjectRegistry) {
  const container = registry.resolvePersistable(THREAD_CLASS_ID)?.container;
  if (!container) {
    throw new Error(
      `[thread-json] thread 容器持久化未注册（${THREAD_CLASS_ID}.persistable.container 缺失）——` +
        `请确认 builtin 已 register。core 仅提供 API，逻辑在 thread builtin。`,
    );
  }
  return container;
}

/**
 * 把线程上下文持久化（thread.json + thread-context.json + inbox）。
 * 委托给 thread builtin 的容器持久化逻辑；线程未携带 persistence ref 时由实现侧静默跳过。
 */
export async function writeThread(thread: ThreadContext): Promise<void> {
  await resolveThreadContainer(builtinRegistry).write(thread);
}

/** 从磁盘恢复线程上下文（委托 thread builtin 容器逻辑），并把 persistence ref 重新挂上。 */
export async function readThread(
  ref: FlowObjectRef,
  threadId: string,
  registry: ObjectRegistry = builtinRegistry,
): Promise<ThreadContext | undefined> {
  return resolveThreadContainer(registry).read(ref, threadId, registry) as Promise<
    ThreadContext | undefined
  >;
}
