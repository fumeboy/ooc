import { Elysia } from "elysia";
import type { createFlowsService } from "./service";
import { sessionIdParams, addUserTalkWindowBody } from "./model";

/**
 * POST /api/flows/:sessionId/talk-windows
 *
 * 在已存在 session 的 user.root 上追加一个新的 talk_window 指向 targetObjectId。
 * 与 seedSession 的差别：
 * - 要求 session 与 user.root 已存在（不会再 createFlowSession）；user.root 缺失抛 NOT_FOUND
 * - 同 target 已存在 talk_window 时**幂等**返回既有那一条
 * - initialMessage 可选；缺省时只挂 window 不派送
 */
export function addUserTalkWindowApi(service: ReturnType<typeof createFlowsService>) {
  return new Elysia({ name: "ooc.flows.api.add-user-talk-window" }).post(
    "/flows/:sessionId/talk-windows",
    ({ params, body }) =>
      service.addUserTalkWindow({
        sessionId: params.sessionId,
        targetObjectId: body.targetObjectId,
        initialMessage: body.initialMessage,
      }),
    { params: sessionIdParams, body: addUserTalkWindowBody },
  );
}
