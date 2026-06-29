import { TODO_async } from "../../transport/todo";
import type { ListThreadsResponse } from "../sessions/types";
import type { ThreadContext } from "./model";

/**
 * 读一条 thread 的完整 ThreadContext(messages / events / contextWindows / status)。
 */
export function fetchThread(sessionId: string, objectId: string, threadId = "root") {
  return TODO_async<ThreadContext>(
    `读 thread(sessionId=${sessionId}, objectId=${objectId}, threadId=${threadId}) 的完整 ThreadContext: messages / events / contextWindows / status; 用于 chat 主面板与 LoopTimeline 显示`,
  );
}

/**
 * 控制面"用户回复"通道。
 *
 * collaborable cross-object talk: 固定走 user.root.talk_window;
 * 后端找不到 talk_window 时返回 NOT_FOUND。targetWindowId 缺省时取首个非 creator
 * talk_window;若 user.root 上有多个 talk 主题,UI 应显式传 targetWindowId。
 */
export function continueThread(sessionId: string, text: string, targetWindowId?: string) {
  return TODO_async<{ jobId?: string; targetObjectId: string; targetThreadId: string }>(
    `控制面用户回复(继续 thread): session=${sessionId} text=<${text.length} chars> targetWindowId=${targetWindowId ?? "(default first non-creator talk_window)"}; 应固定走 user.root.talk_window 投递、触发 jobManager 创建 run-thread job、返回 jobId / 解析的 targetObjectId / targetThreadId`,
  );
}

export function fetchJob(jobId: string) {
  return TODO_async<{ status?: string }>(
    `查询 job(${jobId}) 状态: queued / running / done / failed; 用于 polling thread 调度状态`,
  );
}

/** 列出 session 下所有 (objectId, threadId) — UI thread 切换器数据源。 */
export function fetchSessionThreads(sessionId: string) {
  return TODO_async<{ items: Array<{ objectId: string; threadId: string }> }>(
    `列出 session(${sessionId}) 下所有 (objectId, threadId);用于 ThreadHeader 的 thread 切换器`,
  );
}

/**
 * Q0c: HITL 决议 chat 面板 permission_card 的 approve / reject。
 *
 * eventId = `${toolCallId}_ask`(与 LoopTimeline.buildDecideBody 同款 fallback 规则,避免后端
 * 在多 pending ask 场景下选错事件)。toolCallId 缺失时不传 eventId,由 backend 自动选最近一条。
 *
 * 成功后 backend 会翻 thread.status=running + 触发 jobManager 重启,前端 polling 会自动同步。
 */
export function decideChatPermission(args: {
  sessionId: string;
  objectId: string;
  threadId: string;
  toolCallId?: string;
  action: "approve" | "reject";
}) {
  return TODO_async<{ ok?: boolean }>(
    `HITL 决议 permission_ask 事件(approve/reject): session=${args.sessionId} object=${args.objectId} thread=${args.threadId} toolCall=${args.toolCallId ?? "(latest pending)"} action=${args.action}; 应翻 thread.status=running + 触发 jobManager 重启`,
  );
}

/**
 * 列出 session 下所有 (objectId, threadId) 的完整 metadata — Session Threads Index 用。
 *
 * 与 `fetchSessionThreads` 同 endpoint, 但用 SessionThreads Index 的扩展 shape 类型
 * 标注(后端扩展完成后字段填齐; 期间字段缺失由前端按 ListThreadsItem 中 optional
 * 字段优雅退化)。返回类型故意比后端实际宽松, 允许 minimal `{objectId,threadId}` 也通过。
 */
export async function fetchSessionThreadsFull(
  sessionId: string,
): Promise<ListThreadsResponse> {
  return TODO_async<ListThreadsResponse>(
    `列出 session(${sessionId}) 下所有 thread 的完整 metadata(扩展字段含 title / lastEventAt / hasPendingPermission 等);Session Threads Index 面板用; 后端字段未填齐时前端按 optional 退化`,
  );
}
