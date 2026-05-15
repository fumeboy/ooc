import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { ThreadContext } from "./model";

export function fetchThread(sessionId: string, objectId: string, threadId = "root") {
  return requestJson<ThreadContext>(endpoints.thread(sessionId, objectId, threadId));
}

/**
 * 控制面"用户回复"通道。
 *
 * collaborable § cross-object talk（spec 2026-05-15）：固定走 user.root.talk_window；
 * 后端找不到 talk_window 时返回 NOT_FOUND。targetWindowId 缺省时取首个非 creator
 * talk_window；若 user.root 上有多个 talk 主题，UI 应显式传 targetWindowId。
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
  return requestJson<{ status?: string }>(endpoints.job(jobId));
}

/** 列出 session 下所有 (objectId, threadId)；UI thread 切换器用。 */
export function fetchSessionThreads(sessionId: string) {
  return requestJson<{ items: Array<{ objectId: string; threadId: string }> }>(
    endpoints.sessionThreads(sessionId),
  );
}
