import { requestJson } from "../../transport/http";
import { endpoints } from "../../transport/endpoints";
import type { FlowSession } from "./model";

/**
 * 列出所有 flow session — S4 (2026-06-29) 解桩, 走 GET /api/flows。
 */
export function fetchFlows() {
  return requestJson<{ items: FlowSession[]; hash: string }>(endpoints.flows);
}

/**
 * 暂停 session 调度 — S4 (2026-06-29) 解桩, 走 POST /api/flows/:sid/pause。
 *
 * 进程内开关: 不影响已 inflight 的 LLM 请求, 但 enqueueScheduler 检查后跳过新入队。
 */
export function pauseFlowSession(sessionId: string) {
  return requestJson<{ sessionId: string; paused: true }>(endpoints.pauseSession(sessionId), {
    method: "POST",
  });
}

/**
 * 恢复 session 调度 — S4 (2026-06-29) 解桩, 走 POST /api/flows/:sid/resume。
 *
 * 扫 session 内 running/waiting (非 skip_scheduling) thread, 唤醒 worker。
 */
export function resumeFlowSession(sessionId: string) {
  return requestJson<{ sessionId: string; paused: false; resumedThreadIds: string[]; jobIds: string[] }>(
    endpoints.resumeSession(sessionId),
    { method: "POST" },
  );
}
