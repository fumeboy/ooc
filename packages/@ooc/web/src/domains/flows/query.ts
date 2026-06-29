import { TODO_async } from "../../transport/todo";
import type { FlowSession } from "./model";

/**
 * 列出所有 flow session(world 内所有 sessions, 含 title / lastEventAt 等概要)。
 *
 * 返回 hash 用于前端轮询时判定整体列表是否变化(若 hash 不变则跳过 diff)。
 */
export function fetchFlows() {
  return TODO_async<{ items: FlowSession[]; hash: string }>(
    `列出 world 内所有 flow session 概要(id / title / status / lastEventAt / paused 等),配 list-level hash 用于轮询去抖`,
  );
}

/**
 * 暂停 session 调度(全 thread 停推)。
 *
 * 进程内开关:不影响已 inflight 的 LLM 请求,但禁止新的 tool dispatch 与
 * jobManager 入队。
 */
export function pauseFlowSession(sessionId: string) {
  return TODO_async<{ sessionId: string; paused: true }>(
    `暂停 session(${sessionId}) 调度:全 thread 停推,进程内开关; 不打断 inflight LLM 请求; 禁新 tool dispatch + jobManager 入队`,
  );
}

/**
 * 恢复 session 调度(把 pause 期间被 fail-fast 的 thread 重新入队)。
 *
 * 返回 resumedThreadIds / jobIds 让 UI 显示哪些 thread 被重启了。
 */
export function resumeFlowSession(sessionId: string) {
  return TODO_async<{ sessionId: string; paused: false; resumedThreadIds: string[]; jobIds: string[] }>(
    `恢复 session(${sessionId}) 调度:扫 pause 期间停在 running/waiting 但未推进的 thread,重新 enqueueScheduler;返回 resumedThreadIds + jobIds`,
  );
}
