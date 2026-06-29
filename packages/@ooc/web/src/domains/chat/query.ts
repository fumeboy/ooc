import { TODO_async } from "../../transport/todo";
import { requestJson } from "../../transport/http";
import { endpoints } from "../../transport/endpoints";
import type { ListThreadsResponse } from "../sessions/types";
import type { ThreadContext } from "./model";

/**
 * 读一条 thread 的完整 ThreadContext(messages / events / contextWindows / status)。
 * S6 (2026-06-29) 解桩 — 走 GET /api/flows/:sid/:oid/threads/:tid。
 */
export function fetchThread(sessionId: string, objectId: string, threadId = "root") {
  return requestJson<ThreadContext>(endpoints.thread(sessionId, objectId, threadId));
}

/**
 * 控制面"用户回复"通道。
 *
 * S5 (2026-06-29) 解桩 — 走 POST /api/flows/:sid/continue:
 *   - text append 进 target thread.messages (from="caller")
 *   - targetWindowId 显式给 → 用; 缺省 → user.root.contextWindows 末尾 (最新加入)
 *   - 触发 scheduleSession 唤醒目标 worker
 *   - 返回 { jobId?, targetObjectId, targetThreadId }
 */
export function continueThread(sessionId: string, text: string, targetWindowId?: string) {
  return requestJson<{ jobId?: string; targetObjectId: string; targetThreadId: string }>(
    endpoints.continueThread(sessionId),
    {
      method: "POST",
      body: JSON.stringify({ text, ...(targetWindowId ? { targetWindowId } : {}) }),
    },
  );
}

export function fetchJob(jobId: string) {
  // S7 (2026-06-29) 解桩 — 走 GET /api/runtime/jobs/:id
  return requestJson<{ status?: string; kind?: string; sessionId?: string; createdAt?: number; finishedAt?: number; error?: string }>(
    endpoints.job(jobId),
  );
}

/**
 * 列出 session 下所有 thread (objectId+threadId+扩展元数据)。
 * S6 (2026-06-29) 解桩 — 走 GET /api/flows/:sid/threads。
 *
 * 注: 接口返回 items[] 含扩展字段 (messageCount/eventCount/lastEventAt/calleeObjectId/
 * skipScheduling)。Web 端按需消费 (ThreadHeader 列表 + Session Threads Index)。
 */
export function fetchSessionThreads(sessionId: string) {
  return requestJson<{ sessionId: string; items: Array<{ objectId: string; threadId: string }> }>(
    endpoints.sessionThreads(sessionId),
  );
}

/**
 * **已退役**(issue S10, 2026-06-29): permission_ask / HITL 机制在新 OOC 设计权威中无对应位置
 * (knowledge/index.md §A-E 各维度均未含此通路, 4 个 tool 原语恒定为 exec/close/wait/open)。
 *
 * 用户裁决: "permission_ask 退役, 之后系统设计稳定后再加入"。
 */
export function decideChatPermission(args: {
  sessionId: string;
  objectId: string;
  threadId: string;
  toolCallId?: string;
  action: "approve" | "reject";
}) {
  void args;
  return TODO_async<{ ok?: boolean }>(
    `[退役] permission_ask 机制在新 OOC 设计权威中无对应位置(4 tool 原语恒定); 用户裁决 S10 退役; 系统设计稳定后另起 issue 重新评估 HITL 通路`,
  );
}

/**
 * 列出 session 下所有 thread 的完整 metadata — Session Threads Index 用。
 * S6 (2026-06-29) 解桩 — 同 fetchSessionThreads endpoint, 扩展 shape 由 ListThreadsResponse
 * 类型标注; 后端字段未填齐时前端按 optional 退化。
 */
export async function fetchSessionThreadsFull(
  sessionId: string,
): Promise<ListThreadsResponse> {
  return requestJson<ListThreadsResponse>(endpoints.sessionThreads(sessionId));
}
