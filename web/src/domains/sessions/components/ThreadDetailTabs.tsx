/**
 * ThreadDetailTabs — (Batch 3 placeholder)
 * Full implementation in Batch 3.
 */
import type { ThreadContext } from "../../chat/model";

export function ThreadDetailTabs({
  sessionId,
  objectId,
  threadId,
}: {
  sessionId: string;
  objectId: string;
  threadId: string;
  thread?: ThreadContext;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
}) {
  return (
    <div className="section compact" style={{ padding: 24 }}>
      <strong>Thread: {objectId} / {threadId}</strong>
      <p className="muted small" style={{ marginTop: 8 }}>
        Session: {sessionId}
      </p>
      <p className="muted small" style={{ marginTop: 4 }}>
        (Batch 3) Context Snapshot tab + Loop Timeline tab coming in Batch 3+5.
      </p>
    </div>
  );
}
