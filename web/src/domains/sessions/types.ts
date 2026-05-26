/**
 * Web 端镜像类型 — Session Threads Index 数据契约。
 *
 * 与后端 `GET /api/flows/:sessionId/threads` 的返回 shape 对齐（同步于
 * `docs/2026-05-26-session-threads-index-design.md § 4.1`）。
 *
 * 设计原则：
 * - 与 LoopMeta 一样 web 端复声明,不跨 src/ 边界 import,避免编译耦合。
 * - 字段除 `objectId` / `threadId` 外**全部 optional** — D2 sub agent
 *   并行扩展 API 期间,后端可能仍返回 minimal shape `{objectId,threadId}`；
 *   web 端识别这种情况,优雅退化为"仅 thread 列表无 status/关系"。
 * - 类型只反映"可能存在的字段",运行时仍需 narrowing。
 */

export type ThreadStatus =
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "paused"
  | "ephemeral";

/** talk_window 维度的关系摘要 — 跨 object 协作的"对端"。 */
export interface ThreadTalkPeer {
  targetObjectId: string;
  targetThreadId?: string;
  windowId: string;
}

/** share/ref window 维度的关系摘要。 */
export interface ThreadShareHolding {
  windowId: string;
  kind: "ref";
  ownerObjectId?: string;
  ownerThreadId?: string;
}

export interface ThreadShareLent {
  windowId: string;
  borrowerObjectId?: string;
  borrowerThreadId?: string;
}

export interface ThreadShares {
  holding: ThreadShareHolding[];
  lentOut: ThreadShareLent[];
}

/** 单个 (object, thread) 二元组在列表中的全部展示元数据。 */
export interface ListThreadsItem {
  objectId: string;
  threadId: string;
  status?: ThreadStatus;
  createdAt?: number;
  parentThreadId?: string;
  creatorThreadId?: string;
  creatorObjectId?: string;
  childThreadIds?: string[];
  talkPeers?: ThreadTalkPeer[];
  shares?: ThreadShares;
  /** true 表示属 super flow(`sessionId === "super"` 或 thread 关联 reflectable)。 */
  isSuperFlow?: boolean;
  /** 可选 thread 标题（后端如有写入则直接用，否则前端 humanize 派生）。 */
  title?: string;
}

export interface ListThreadsResponse {
  items: ListThreadsItem[];
}
