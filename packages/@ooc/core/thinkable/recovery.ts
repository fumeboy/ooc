import type { ProcessEvent, ThreadContext } from "./context";

/**
 * 中断恢复检测与标记 (thinkable 维度的纯函数 hook)。
 *
 * 背景: scheduler tick 顺序是
 *
 *     nextThread.lastExecutedAt = Date.now();
 *     await think(nextThread, llmClient);   // 内部 beginLlmLoop 写 llm.input.json
 *                                           // 然后 push call_started + writeThread 落盘
 *                                           // 然后 await llmClient.generate(...)  ← 可能被 SIGKILL / hang
 *     await writeThread(nextThread);
 *
 * 任何在 generate 期间进程被打断 / 网络挂死的情况:
 *   - llm.input.json 已落盘
 *   - thread.json 末尾事件是 llm_interaction.call_started
 *   - 之后没有任何 llm_interaction (text/function_call/thinking)
 *
 * 此模块给 worker bootstrap 提供两个纯函数 (不依赖 worker 状态), 让 worker 启动时
 * 把磁盘上 status="running" / "waiting" 的 thread 扫一遍, 标记中断, 不删 debug 资产,
 * 不改 status, 让 worker 的常规 enqueue 把它继续推进。
 */

export interface DetectInterruptedOptions {
  /**
   * 历史数据 fallback: 没有 call_started 标记,
   * 但 debug/llm.input.json 存在。caller 可显式传 debugInputExists=true, 配合 events 中
   * **任意位置**都没有 llm_interaction 事件 → 也判定为中断。
   *
   * 仅服务历史数据迁移; 新数据有 call_started 标记, 不依赖此 fallback。
   */
  debugInputExists?: boolean;
}

export interface InterruptedDetection {
  interrupted: boolean;
  reason?: string;
}

const LLM_INTERACTION_KIND_HAS_RESPONSE: ReadonlySet<string> = new Set([
  "text",
  "function_call",
  "tool_use",
  "thinking",
]);

function isLlmInteraction(event: ProcessEvent): boolean {
  return event.category === "llm_interaction";
}

/**
 * 判定 thread 是否在上一轮 think 中被中断。
 *
 * 主路径 (新数据): events 末尾是 llm_interaction.call_started 且其后**没有**任何
 *                  llm_interaction (text/function_call/thinking 等) ⇒ interrupted。
 *
 * Fallback (旧数据): opts.debugInputExists=true && events 中**任意位置**都没有 llm_interaction
 *                    ⇒ interrupted。仅服务历史数据迁移。
 *
 * 不改写 thread, 调用方按需决定是否 markInterrupted。
 */
export function detectInterruptedThread(
  thread: ThreadContext,
  opts: DetectInterruptedOptions = {},
): InterruptedDetection {
  const events = thread.events ?? [];

  // 主路径: 找最近一条 call_started, 看其后是否还有 llm_interaction 响应类事件。
  let lastCallStartedIdx = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.category === "llm_interaction" && event.kind === "call_started") {
      lastCallStartedIdx = i;
      break;
    }
  }
  if (lastCallStartedIdx >= 0) {
    const tail = events.slice(lastCallStartedIdx + 1);
    const hasResponse = tail.some(
      (e) => e.category === "llm_interaction" && LLM_INTERACTION_KIND_HAS_RESPONSE.has(e.kind),
    );
    if (!hasResponse) {
      return {
        interrupted: true,
        reason: `trailing call_started at index ${lastCallStartedIdx} without subsequent llm_interaction response`,
      };
    }
    return { interrupted: false };
  }

  // Fallback: 没有 call_started 标记 (旧数据)。仅在 caller 显式传 debugInputExists 时检查。
  if (opts.debugInputExists) {
    const anyLlmInteraction = events.some(isLlmInteraction);
    if (!anyLlmInteraction) {
      return {
        interrupted: true,
        reason: "legacy fallback: debug/llm.input.json exists but no llm_interaction events",
      };
    }
  }

  return { interrupted: false };
}

/**
 * 给被检测为中断的 thread 写一条 inject event, 让 LLM 下一 tick 自然看到。
 *
 * 不改 thread.status — 让 worker bootstrap 的常规 enqueue 路径继续推进。
 * 不删 debug 文件 — observability 资产, 只读不删。
 */
export function markInterrupted(thread: ThreadContext): void {
  thread.events = [
    ...(thread.events ?? []),
    {
      category: "context_change",
      kind: "inject",
      text: "[interrupted] previous LLM call did not complete; will retry on next tick.",
      source: "thinkable/recovery#markInterrupted",
      errorCode: "llm_call_interrupted",
    },
  ];
}
