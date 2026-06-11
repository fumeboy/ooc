import { useEffect, useState } from "react";
import type { Stone } from "../../stones";
import { useDisplayNames } from "../../objects";
import { defaultObjectId, defaultSessionId } from "../policy";
import { Button } from "../../../shared/ui/Button";
import { Input } from "../../../shared/ui/input";
import { Label } from "../../../shared/ui/label";
import { Select } from "../../../shared/ui/select";
import { Textarea } from "../../../shared/ui/textarea";

/**
 * SessionCreator — collaborable § cross-object talk 下的 session 创建表单。
 *
 * targetObjectId（"对方 object"）与 initialMessage（"第一句话"）现在都必填——
 * 创建 session 等价于 user 对该 target 发起初次 talk。
 */
export function SessionCreator({
  stones,
  onCreate,
  initialSessionId,
}: {
  stones: Stone[];
  onCreate: (input: { sessionId: string; targetObjectId: string; initialMessage: string }) => Promise<void>;
  /**
   * 当用户从 UserThreadHome 的"Seed via welcome"按钮跳来时,
   * 预填这个 sessionId(已被裸创建过的空 session),避免用户复制 / 错填。
   */
  initialSessionId?: string;
}) {
  const [sessionId, setSessionId] = useState(initialSessionId ?? defaultSessionId());
  const [targetObjectId, setTargetObjectId] = useState(defaultObjectId(stones));
  const [initialMessage, setInitialMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!targetObjectId) setTargetObjectId(defaultObjectId(stones));
  }, [targetObjectId, stones]);

  const canSubmit = !busy && sessionId.trim() && targetObjectId.trim() && initialMessage.trim();
  // 创建期间整个表单 freeze, 避免用户重复编辑 / 重复提交。
  const inputsDisabled = busy;
  // displayName 派生(spec):option label 显示语义化名,value 仍是 objectId
  const names = useDisplayNames(stones.map((s) => s.objectId));

  return (
    <fieldset className="welcome-form-grid welcome-form-fieldset" disabled={inputsDisabled}>
      {stones.length === 0 && (
        <div className="welcome-form-notice">需要先创建至少一个 stone，才能选择对话对象。</div>
      )}

      <div className="welcome-form-field">
        <Label htmlFor="session-id">session id</Label>
        <Input
          id="session-id"
          value={sessionId}
          onChange={(event) => setSessionId(event.target.value)}
          placeholder="session id"
          disabled={inputsDisabled}
        />
      </div>

      <div className="welcome-form-field">
        <Label htmlFor="target-object-id">对话对象（objectId）</Label>
        <Select
          id="target-object-id"
          value={targetObjectId}
          onChange={(event) => setTargetObjectId(event.target.value)}
          disabled={stones.length === 0 || inputsDisabled}
        >
          {stones.map((stone) => (
            <option key={stone.objectId} value={stone.objectId} title={stone.objectId}>{names[stone.objectId] ?? stone.objectId}</option>
          ))}
        </Select>
      </div>

      <div className="welcome-form-field">
        <Label htmlFor="initial-message">第一条消息</Label>
        <Textarea
          id="initial-message"
          value={initialMessage}
          onChange={(event) => setInitialMessage(event.target.value)}
          placeholder="user 发给对方的第一条消息（必填）"
          disabled={inputsDisabled}
        />
      </div>

      <div className="welcome-form-actions">
        <Button
          variant="primary"
          size="lg"
          className="welcome-submit-btn"
          data-testid="create-session-submit"
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
          {busy ? "创建中…" : "创建 session"}
        </Button>
      </div>
    </fieldset>
  );
}
