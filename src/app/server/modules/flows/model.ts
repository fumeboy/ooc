import { t } from "elysia";

export const sessionIdParams = t.Object({ sessionId: t.String() });
export const flowObjectParams = t.Object({
  sessionId: t.String(),
  objectId: t.String(),
});
export const threadParams = t.Object({
  sessionId: t.String(),
  objectId: t.String(),
  threadId: t.String(),
});
export const createSessionBody = t.Object({
  sessionId: t.String(),
  title: t.Optional(t.String()),
});
export const createFlowObjectBody = t.Object({
  objectId: t.String(),
  /** 可选：传了就把它作为 root thread 的初始 inject 事件，并立即入队 run-thread job。 */
  initialMessage: t.Optional(t.String()),
});
export const callMethodBody = t.Object({
  method: t.String(),
  args: t.Optional(t.Record(t.String(), t.Any())),
});

/**
 * 继续指定 thread 会话的请求体。
 *
 * collaborable § cross-object talk（spec 2026-05-15）：
 * - threadId/objectId 路径参数已移除：continueThread 现在固定走 user.root.talk_window
 *   再 deliverTalkMessage 到 callee；前端只需要给 sessionId + 文本 + 可选 targetWindowId
 */
export const continueThreadBody = t.Object({
  text: t.String(),
  targetWindowId: t.Optional(t.String()),
});

/**
 * Seed 一个新 session：建 session + user flow object + user 对 target 的初次 talk。
 *
 * collaborable § cross-object talk（spec 2026-05-15）。
 */
export const seedSessionBody = t.Object({
  sessionId: t.String(),
  title: t.Optional(t.String()),
  targetObjectId: t.String(),
  initialMessage: t.String(),
});
