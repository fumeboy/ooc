/**
 * Session Threads Index data contract — ooc-3 adaptation.
 *
 * Fields other than objectId/threadId are all optional — ooc-3 backend
 * returns minimal shape {objectId, threadId}; UI degrades gracefully.
 */

export type ThreadStatus =
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "paused"
  | "ephemeral";

export interface ThreadTalkPeer {
  targetObjectId: string;
  targetThreadId?: string;
  windowId: string;
}

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
  isSuperFlow?: boolean;
  title?: string;
}

export interface ListThreadsResponse {
  items: ListThreadsItem[];
}
