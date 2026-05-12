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

/** 继续指定 thread 会话的请求体。 */
export const continueThreadBody = t.Object({
  text: t.String(),
});
