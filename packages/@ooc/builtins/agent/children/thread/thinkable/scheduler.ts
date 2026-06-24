import type { LlmClient } from "@ooc/core/thinkable/llm/types";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";
import { think } from "./thinkloop";
import { iterateSessionObjectTable } from "@src/runtime/session-object-table";
import { OocObjectInstance } from "@src/runtime/ooc-class";

/**
 * 运行线程树调度循环。
 *
 * 每个 tick：
 * 1. 把已结束的子线程通知写到父 inbox（system 消息）
 * 2. 看哪些 waiting 线程因 event 增长可以唤醒
 * 3. 选一个 running 线程执行一轮 think
 */
export async function runScheduler(
  sessionId: string,
  llmClient: LlmClient,
): Promise<void> {
  for (; ;) {
    const threads: ThreadContext[] = [];
    iterateSessionObjectTable(sessionId, (instance_) => {
      if (instance_.class !== "_builtin/agent/thread") {
        return
      }
      let instance = instance_ as OocObjectInstance<ThreadContext>
      if (instance.data.status !== "running" && instance.data.status !== "waiting") {
        return
      }
      threads.push(instance.data);
    });

    // wake waiting threads on inbox
    for (const thread of threads) {
      if (thread.status !== "waiting") continue;
      let lastEventCreatedAt = thread.events?.[thread.events.length - 1]?.createdAt ?? 0;
      if (thread.lastExecutedAt ?? 0 < lastEventCreatedAt) {
        thread.status = "running";
      }
    }

    const runningThreads = threads.filter((thread) => thread.status === "running");
    if (runningThreads.length === 0) return;

    const nextThread =  [...runningThreads].sort((a, b) => {
      const left = a.lastExecutedAt ?? 0;
      const right = b.lastExecutedAt ?? 0;
      if (left !== right) return left - right;
      return a.id.localeCompare(b.id);
    })[0]!;

    nextThread.lastExecutedAt = Date.now();
    await think(nextThread, llmClient);
  }
}
