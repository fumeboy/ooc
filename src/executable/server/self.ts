import { mergeData, readData, stoneDir, type StoneObjectRef } from "../../persistable";
import type { ThreadContext } from "../../thinkable/context";
import { loadServerMethods } from "./loader";
import type { ProgramSelf, ServerMethodContext } from "./types";

/**
 * 构造 program 模式注入的 self 对象。
 * - thread 是当前调用方线程，server method 可通过 ctx.thread.inject 推 inject 事件
 * - callMethod 自动 lazy load + reload server/index.ts（按 mtime）
 * - getData/setData 直接读写 stone 的 data.json（顶层 merge）
 */
export function createProgramSelf(
  stoneRef: StoneObjectRef,
  thread: ThreadContext
): ProgramSelf {
  const dir = stoneDir(stoneRef);
  const self: ProgramSelf = {
    dir,
    async callMethod(name, args = {}) {
      const methods = await loadServerMethods(stoneRef);
      const method = methods[name];
      if (!method) {
        const available = Object.keys(methods).join(", ") || "(空)";
        throw new Error(`方法 ${name} 不存在；当前可用：${available}`);
      }
      const ctx: ServerMethodContext = {
        self,
        thread: {
          id: thread.id,
          inject: (text) => {
            thread.events.push({
              category: "context_change",
              kind: "inject",
              text
            });
          },
          persistence: thread.persistence
            ? {
                baseDir: thread.persistence.baseDir,
                sessionId: thread.persistence.sessionId,
                objectId: thread.persistence.objectId,
                threadId: thread.persistence.threadId,
              }
            : undefined,
        }
      };
      return method.fn(ctx, args);
    },
    async getData(key) {
      const data = (await readData(stoneRef)) ?? {};
      return data[key];
    },
    async setData(key, value) {
      await mergeData(stoneRef, { [key]: value });
    },
    /**
     * thread-local 数据：program_window 跨 exec 时由 ts/js sandbox 通过这里传值。
     * 直接 mutate thread.threadLocalData，不经持久化（重启即丢）。
     */
    getThreadLocal(key) {
      return thread.threadLocalData?.[key];
    },
    setThreadLocal(key, value) {
      if (!thread.threadLocalData) thread.threadLocalData = {};
      thread.threadLocalData[key] = value;
    },
  };
  return self;
}
