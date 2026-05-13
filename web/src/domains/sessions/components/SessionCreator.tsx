import { useEffect, useState } from "react";
import type { Stone } from "../../stones";
import { defaultObjectId, defaultSessionId } from "../policy";
import { Button } from "../../../shared/ui/Button";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Select } from "../../../shared/ui/select";
import { Textarea } from "../../../shared/ui/textarea";

export function SessionCreator({ stones, onCreate }: { stones: Stone[]; onCreate: (input: { sessionId: string; objectId: string; initialMessage?: string }) => Promise<void> }) {
  const [sessionId, setSessionId] = useState(defaultSessionId());
  const [objectId, setObjectId] = useState(defaultObjectId(stones));
  const [initialMessage, setInitialMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!objectId) setObjectId(defaultObjectId(stones));
  }, [objectId, stones]);

  return (
    <div className="welcome-form-grid">
      {stones.length === 0 && <div className="welcome-form-notice">需要先创建至少一个 stone，才能选择入口 object。</div>}

      <div className="welcome-form-field">
        <Label htmlFor="session-id">Session ID</Label>
        <Input id="session-id" value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="session id" />
      </div>

      <div className="welcome-form-field">
        <Label htmlFor="object-id">Entry object</Label>
        <Select id="object-id" value={objectId} onChange={(event) => setObjectId(event.target.value)} disabled={stones.length === 0}>
          {stones.map((stone) => <option key={stone.objectId} value={stone.objectId}>{stone.objectId}</option>)}
        </Select>
      </div>

      <div className="welcome-form-field">
        <Label htmlFor="initial-message">Initial message</Label>
        <Textarea id="initial-message" value={initialMessage} onChange={(event) => setInitialMessage(event.target.value)} placeholder="Optional first prompt for the new session" />
      </div>

      <div className="welcome-form-actions">
        <Button
          variant="primary"
          size="lg"
          className="welcome-submit-btn"
          disabled={busy || !sessionId || !objectId}
          onClick={async () => {
            setBusy(true);
            try {
              await onCreate({ sessionId, objectId, initialMessage });
              setSessionId(defaultSessionId());
              setInitialMessage("");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : "Create session"}
        </Button>
      </div>
    </div>
  );
}
