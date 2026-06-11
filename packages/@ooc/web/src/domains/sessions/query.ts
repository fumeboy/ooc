import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { CreateSessionInput, CreatedSession } from "./model";

/**
 * 创建 session：等价于 user 对 target object 的初次 talk。
 *
 * collaborable cross-object talk：
 * 后端 POST /api/sessions 一次性 seed session + user flow object + user.root
 * 上指向 target 的 talk_window + 派送 initialMessage 到 callee thread。
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
  /** initialMessage 缺省时不派送，没有 callee thread；undefined 表示尚未 deliver。 */
  targetThreadId?: string;
  jobId?: string;
  /** false 表示同 target 已存在 talk_window，本次返回的是既有那一条（idempotent）。 */
  created: boolean;
}

/**
 * 在已存在 session 的 user.root 上追加新 talk_window 指向 targetObjectId。
 *
 * - initialMessage 缺省 → 仅挂 talk_window 不派送，targetThreadId/jobId 为 undefined
 * - 同 target 已存在非 creator talk_window → 幂等返回，created=false
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
