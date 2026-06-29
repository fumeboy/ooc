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
 * **已退役**(issue S10, 2026-06-29): permission_ask / HITL 机制在新 OOC 设计权威中无对应位置
 * (knowledge/index.md §A-E 各维度均未含此通路, 4 个 tool 原语恒定为 exec/close/wait/open)。
 *
 * 用户裁决: "permission_ask 退役, 之后系统设计稳定后再加入"。
 *
 * 本函数保留作 future HITL 通路恢复时的占位 — 永抛 TODO "已退役"。配合
 * threadHasPendingPermission() 恒返 false, UI 中 permission card 永不展示。
 * 若未来重新引入 HITL, 重新设计 endpoint 协议后再解桩(或这套通道整体重写)。
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
