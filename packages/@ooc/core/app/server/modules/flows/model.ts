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
 * collaborable cross-object talk：
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
 * collaborable cross-object talk。
 */
export const seedSessionBody = t.Object({
  sessionId: t.String(),
  title: t.Optional(t.String()),
  targetObjectId: t.String(),
  initialMessage: t.String(),
});

/**
 * 在已存在 session 的 user.root 上追加一个新 talk_window 指向 targetObjectId。
 * initialMessage 可选：缺省时只挂 talk_window 不派送；提供时同 seedSession 一样
 * 走 deliverTalkMessage 创建 callee thread + 写消息 + 入队。
 */
export const addUserTalkWindowBody = t.Object({
  targetObjectId: t.String(),
  initialMessage: t.Optional(t.String()),
});

/**
 * GET /api/flows/:sessionId/threads 的返回 shape。
 *
 * 旧 shape 仅 `{ objectId, threadId }`；新版扩展为 thread metadata + 4 种关系字段，
 * 让前端 SessionThreadsIndex 能据此画分栏 + 关系。向后兼容：旧字段保留、新字段都是
 * 可选 / 空数组退化，老前端不会因为多字段而炸。
 */
export type ThreadShareInfo = {
  /** 本 thread 持有的、由别处借进来的只读 ref window。 */
  holding: Array<{
    windowId: string;
    kind: "ref";
    /** sharing.ownerThreadId（来自 SharingState.ref）。 */
    ownerThreadId?: string;
    /** sharing 未持久化 ownerObjectId；当前永远 undefined（design 预留位）。 */
    ownerObjectId?: string;
  }>;
  /** 本 thread 持有的、已借出给别处的 window（自己保留 freeze snapshot）。 */
  lentOut: Array<{
    windowId: string;
    /** sharing.borrowerThreadId（来自 SharingState.lent_out）。 */
    borrowerThreadId?: string;
    /** sharing 未持久化 borrowerObjectId；当前永远 undefined（design 预留位）。 */
    borrowerObjectId?: string;
  }>;
};

export type ListThreadsItem = {
  objectId: string;
  threadId: string;
  status: "running" | "waiting" | "done" | "failed" | "paused";
  createdAt?: number;
  parentThreadId?: string;
  creatorThreadId?: string;
  creatorObjectId?: string;
  childThreadIds: string[];
  /** thread 的 talk_window 摘要；跨 object talk 关系数据源。 */
  talkPeers: Array<{
    targetObjectId: string;
    targetThreadId?: string;
    windowId: string;
  }>;
  shares: ThreadShareInfo;
  /** sessionId === "super" 时为 true（reflectable super flow）。 */
  isSuperFlow?: boolean;
};

export type ListThreadsResponse = { items: ListThreadsItem[] };
