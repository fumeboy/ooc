/**
 * thread.json 的 **path 原语 + 对外 API（薄壳 dispatch）**——core 框架，不含 thread 序列化逻辑。
 *
 * `writeThread`/`readThread` 是 core 暴露给 runtime 引擎（thinkloop/scheduler/worker/resume/
 * service）的稳定 API；它们经 registry 解析出 thread builtin 的标准 `persistable.save`/`load`，用
 * **thread 作用域 ctx**（含二级寻址 threadId）**委托**。thread 怎么落盘（thread.json strip 规则 /
 * thread-context 窗状态 inline vs `_ref` / inbox / hydrate）是 **thread builtin 的逻辑**
 * （`@ooc/builtins/agent/thread/persistable/thread-persist.ts`），不在 core——core 只提供框架与 API
 * （object-model 核心 7 + persistable「core=框架+API」边界）。
 */
import { join } from "node:path";
import { threadDir, type FlowObjectRef, type ThreadPersistenceRef } from "./common.js";
import type { PersistableContext, PersistableModule } from "./contract.js";
import type { ThreadContext } from "../thinkable/context.js";
import type { ObjectRegistry } from "../runtime/object-registry.js";
import { builtinRegistry } from "../runtime/object-registry.js";
import { THREAD_CLASS_ID } from "../_shared/types/constants.js";

/** 单个线程的 `thread.json` 绝对路径（path 原语，框架）。 */
export function threadFile(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "thread.json");
}

/** 解析 thread builtin 的标准持久化模块（registry dispatch）；未注册 save/load 则 fail-loud。 */
function resolveThreadPersistable(registry: ObjectRegistry): Required<Pick<PersistableModule, "save" | "load">> {
  const p = registry.resolvePersistable(THREAD_CLASS_ID);
  if (!p?.save || !p?.load) {
    throw new Error(
      `[thread-json] thread 持久化未注册（${THREAD_CLASS_ID}.persistable.save/load 缺失）——` +
        `请确认 builtin 已 register。core 仅提供 API，逻辑在 thread builtin。`,
    );
  }
  return { save: p.save, load: p.load };
}

/**
 * 把线程上下文持久化（thread.json + thread-context.json + inbox）。
 * 委托给 thread builtin 的标准 `save`；线程未携带 persistence ref 时由实现侧静默跳过。
 */
export async function writeThread(thread: ThreadContext): Promise<void> {
  const { save } = resolveThreadPersistable(builtinRegistry);
  const p = thread.persistence;
  const ctx: PersistableContext = p
    ? { baseDir: p.baseDir, objectId: p.objectId, sessionId: p.sessionId, threadId: p.threadId, dir: threadDir(p) }
    : { baseDir: "", objectId: "", dir: "" };
  await save(ctx, thread);
}

/** 从磁盘恢复线程上下文（委托 thread builtin 标准 `load`），并把 persistence ref 重新挂上。 */
export async function readThread(
  ref: FlowObjectRef,
  threadId: string,
): Promise<ThreadContext | undefined> {
  const { load } = resolveThreadPersistable(builtinRegistry);
  const refWithThread: ThreadPersistenceRef = { ...ref, threadId };
  const ctx: PersistableContext = {
    baseDir: ref.baseDir,
    objectId: ref.objectId,
    sessionId: ref.sessionId,
    threadId,
    dir: threadDir(refWithThread),
  };
  return (await load(ctx)) as ThreadContext | undefined;
}
