import { useEffect, useState } from "react";
import type { Stone } from "../../stones";
import { defaultObjectId, defaultSessionId } from "../policy";
import { Button } from "../../../shared/ui/Button";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Select } from "../../../shared/ui/select";
import { Textarea } from "../../../shared/ui/textarea";

/**
 * SessionCreator — collaborable § cross-object talk（spec 2026-05-15）下的 session 创建表单。
 *
 * targetObjectId（"对方 object"）与 initialMessage（"第一句话"）现在都必填——
 * 创建 session 等价于 user 对该 target 发起初次 talk。
 */
export function SessionCreator({
  stones,
  onCreate,
}: {
  stones: Stone[];
  onCreate: (input: { sessionId: string; targetObjectId: string; initialMessage: string }) => Promise<void>;
}) {
  const [sessionId, setSessionId] = useState(defaultSessionId());
  const [targetObjectId, setTargetObjectId] = useState(defaultObjectId(stones));
  const [initialMessage, setInitialMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!targetObjectId) setTargetObjectId(defaultObjectId(stones));
  }, [targetObjectId, stones]);

  const canSubmit = !busy && sessionId.trim() && targetObjectId.trim() && initialMessage.trim();

  return (
    <div className="welcome-form-grid">
      {stones.length === 0 && (
        <div className="welcome-form-notice">需要先创建至少一个 stone，才能选择对话对象。</div>
      )}

      <div className="welcome-form-field">
        <Label htmlFor="session-id">Session ID</Label>
        <Input
          id="session-id"
          value={sessionId}
          onChange={(event) => setSessionId(event.target.value)}
          placeholder="session id"
        />
      </div>

      <div className="welcome-form-field">
        <Label htmlFor="target-object-id">Talk to (objectId)</Label>
        <Select
          id="target-object-id"
          value={targetObjectId}
          onChange={(event) => setTargetObjectId(event.target.value)}
          disabled={stones.length === 0}
        >
          {stones.map((stone) => (
            <option key={stone.objectId} value={stone.objectId}>{stone.objectId}</option>
          ))}
        </Select>
      </div>

      <div className="welcome-form-field">
        <Label htmlFor="initial-message">First message</Label>
        <Textarea
          id="initial-message"
          value={initialMessage}
          onChange={(event) => setInitialMessage(event.target.value)}
          placeholder="user 发给对方的第一条消息（必填）"
        />
      </div>

      <div className="welcome-form-actions">
        <Button
          variant="primary"
          size="lg"
          className="welcome-submit-btn"
          disabled={!canSubmit}
          onClick={async () => {
            setBusy(true);
            try {
              await onCreate({
                sessionId: sessionId.trim(),
                targetObjectId: targetObjectId.trim(),
                initialMessage: initialMessage.trim(),
              });
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
