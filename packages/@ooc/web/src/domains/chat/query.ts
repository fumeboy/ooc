import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { ListThreadsResponse } from "../sessions/types";
import type { ThreadContext } from "./model";

export function fetchThread(sessionId: string, objectId: string, threadId = "root") {
  return requestJson<ThreadContext>(endpoints.thread(sessionId, objectId, threadId));
}

/**
 * 控制面"用户回复"通道。
 *
 * collaborable § cross-object talk：固定走 user.root.talk_window；
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

/**
 * Q0c: HITL 决议 chat 面板 permission_card 的 approve / reject。
 *
 * eventId = `${toolCallId}_ask`（与 LoopTimeline.buildDecideBody 同款 fallback 规则，避免后端
 * 在多 pending ask 场景下选错事件）。toolCallId 缺失时不传 eventId，由 backend 自动选最近一条。
 *
 * 成功后 backend 会翻 thread.status=running + 触发 jobManager 重启，前端 polling 会自动同步。
 */
export function decideChatPermission(args: {
  sessionId: string;
  objectId: string;
  threadId: string;
  toolCallId?: string;
  action: "approve" | "reject";
}) {
  const body: Record<string, unknown> = { action: args.action };
  if (args.toolCallId) body.eventId = `${args.toolCallId}_ask`;
  return requestJson<{ ok?: boolean }>(
    endpoints.runtimeDecidePermission(args.sessionId, args.objectId, args.threadId),
    { method: "POST", body: JSON.stringify(body) },
  );
}

/**
 * 列出 session 下所有 (objectId, threadId) 的完整 metadata —— Session Threads Index 用。
 *
 * 与 `fetchSessionThreads` 同 endpoint, 但用 SessionThreads Index 的扩展 shape 类型
 * 标注（后端扩展完成后字段填齐; 期间字段缺失由前端按 ListThreadsItem 中 optional
 * 字段优雅退化）。返回类型故意比后端实际宽松, 允许 minimal `{objectId,threadId}` 也通过。
 */
export async function fetchSessionThreadsFull(
  sessionId: string,
): Promise<ListThreadsResponse> {
  return requestJson<ListThreadsResponse>(endpoints.sessionThreads(sessionId));
}
