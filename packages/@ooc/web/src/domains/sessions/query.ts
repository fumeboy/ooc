import { requestJson } from "../../transport/http";
import { endpoints } from "../../transport/endpoints";
import type { CreateSessionInput, CreatedSession } from "./model";

/**
 * 创建 session — 等价于 user 对 target object 的初次 talk。
 *
 * S5 (2026-06-29) 解桩 — 走 POST /api/sessions:
 *   - backend 创建 user inst (若不存在)
 *   - 创建 user.root thread (skip_scheduling=true) 作 transcript 容器
 *   - 创建 target agent thread (target=targetObjectId), initialMessage 作为初始 message
 *   - user.root.contextWindows 含指向 target thread 的 ref
 *   - 经 enqueueScheduler 唤醒 worker 推 target thread
 */
export async function createSessionWithObject(input: CreateSessionInput): Promise<CreatedSession> {
  return requestJson<CreatedSession>(endpoints.sessions, {
    method: "POST",
    body: JSON.stringify({
      sessionId: input.sessionId,
      title: input.title ?? input.sessionId,
      targetObjectId: input.targetObjectId,
      initialMessage: input.initialMessage,
    }),
  });
}

export interface AddUserTalkWindowResult {
  sessionId: string;
  talkWindowId: string;
  targetObjectId: string;
  /** initialMessage 缺省时不派送,没有 callee thread;undefined 表示尚未 deliver。 */
  targetThreadId?: string;
  jobId?: string;
  /** false 表示同 target 已存在 talk_window,本次返回的是既有那一条(idempotent)。 */
  created: boolean;
}

/**
 * 在已存在 session 的 user.root 上追加新 talk_window 指向 targetObjectId。
 *
 * S5 (2026-06-29) 解桩 — 走 POST /api/flows/:sid/talk-windows:
 *   - 已存在 session, 加新 target thread + push ref 进 user.root.contextWindows
 *   - 同 target 已存在 → created=false (idempotent)
 */
export async function addUserTalkWindow(
  sessionId: string,
  input: { targetObjectId: string; initialMessage?: string },
): Promise<AddUserTalkWindowResult> {
  return requestJson<AddUserTalkWindowResult>(endpoints.addUserTalkWindow(sessionId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}
