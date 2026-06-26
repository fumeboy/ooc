/**
 * thread thinkable / scheduler —— 线程树调度循环。
 *
 * 设计：
 * - 输入：sessionId + LlmClient + maxTicks
 * - 每 tick：
 *   1. 扫 session 全部 thread（class === THREAD_CLASS_ID）
 *   2. 唤醒 waiting thread（若 messages/events 增长则改 running）
 *   3. 选最早未执行的 running thread，调 think 一轮
 *   4. 全部 thread 都终态 / waiting ⇒ 退出
 *
 * scheduler 不走线程树指针（旧 `_parentThreadRef` 模型已退役）——一律按 sessionId 索引 session
 * 对象表，按 instance.class 筛 thread。
 */
import type { LlmClient } from "@ooc/core/thinkable/llm/types.js";
import { iterateSessionObjectTable, getSessionRegistry } from "@ooc/core/runtime/object-registry.js";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants.js";
import type { ThreadContext } from "../types.js";

export interface SchedulerOptions {
  /** 最大 tick 数（防止失控循环）。 */
  maxTicks?: number;
  /** world 根目录（透给 thinkloop / ThreadRuntime）。 */
  worldDir?: string;
  /** 落盘挂钩。 */
  onDataEdit?: () => Promise<void> | void;
  /**
   * 跨 session 唤醒钩子（worker 注入）——透给 ThreadRuntime 的 `scheduleSession` 用。
   * 见 issue G + ThreadRuntime.scheduleSession JSDoc。
   */
  wakeSession?: (sessionId: string) => void;
}

/** 在一个 session 内跑调度循环，直到所有 thread 终态/waiting 或 maxTicks 耗尽。 */
export async function runScheduler(
  sessionId: string,
  llm: LlmClient,
  opts: SchedulerOptions = {},
): Promise<void> {
  const maxTicks = opts.maxTicks ?? 15;
  const registry = getSessionRegistry(sessionId);

  for (let tick = 0; tick < maxTicks; tick++) {
    const threads: ThreadContext[] = [];
    iterateSessionObjectTable(sessionId, (inst) => {
      if (inst.class !== THREAD_CLASS_ID) return;
      const t = inst.data as ThreadContext;
      if (t.status !== "running" && t.status !== "waiting") return;
      threads.push(t);
    });

    // 唤醒 waiting：本轮 events/messages 较 lastExecutedAt 之后有新增 ⇒ 改 running
    for (const t of threads) {
      if (t.status !== "waiting") continue;
      const lastAt = t.lastExecutedAt ?? 0;
      const lastEvent = t.events[t.events.length - 1]?.createdAt ?? 0;
      const lastMsg = t.messages[t.messages.length - 1]?.createdAt ?? 0;
      if (lastEvent > lastAt || lastMsg > lastAt) {
        t.status = "running";
      }
    }

    const runnable = threads.filter((t) => t.status === "running");
    if (runnable.length === 0) return;

    // 公平选下个 running thread —— 按 lastExecutedAt 排序，id 字典序兜底
    const next = [...runnable].sort((a, b) => {
      const la = a.lastExecutedAt ?? 0;
      const lb = b.lastExecutedAt ?? 0;
      if (la !== lb) return la - lb;
      return a.id.localeCompare(b.id);
    })[0]!;

    next.lastExecutedAt = Date.now();
    // issue H：scheduler 经 resolveThinkable seam 派发 think；不再直 import thinkloop.think。
    // 既有 `inst.class !== THREAD_CLASS_ID` 过滤已挡住非 thread；未命中即注册表损坏 → fail-loud。
    const thinkableMod = registry.resolveThinkable(THREAD_CLASS_ID);
    if (!thinkableMod?.think) {
      throw new Error(`[scheduler] no thinkable.think for class=${THREAD_CLASS_ID}`);
    }
    await thinkableMod.think(next, {
      llm,
      registry,
      worldDir: opts.worldDir,
      onDataEdit: opts.onDataEdit,
      wakeSession: opts.wakeSession,
    });
  }
}
