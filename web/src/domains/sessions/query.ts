import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
import type { CreateSessionInput, CreatedSession } from "./model";

/**
 * 创建 session：等价于 user 对 target object 的初次 talk。
 *
 * collaborable § cross-object talk（spec 2026-05-15）：
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
