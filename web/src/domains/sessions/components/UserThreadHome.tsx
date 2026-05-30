/**
 * UserThreadHome — (Batch 3 placeholder)
 * Full implementation in Batch 3 (sessions domain).
 */
import type { ThreadContext } from "../../chat/model";

export function UserThreadHome({
  sessionId,
}: {
  sessionId: string;
  thread?: ThreadContext;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
}) {
  return (
    <div className="section compact" style={{ padding: 24 }}>
      <strong>Session: {sessionId}</strong>
      <p className="muted small" style={{ marginTop: 8 }}>
        (Batch 3) Full UserThreadHome / SessionThreadsIndex coming in Batch 3.
        Session threads list and StaffView will be available then.
      </p>
    </div>
  );
}
