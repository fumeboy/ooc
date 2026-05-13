import { useEffect, useState } from "react";
import type { Stone } from "../../stones";
import { defaultObjectId, defaultSessionId } from "../policy";
import { Button } from "../../../shared/ui/Button";

export function SessionCreator({ stones, onCreate }: { stones: Stone[]; onCreate: (input: { sessionId: string; objectId: string; initialMessage?: string }) => Promise<void> }) {
  const [sessionId, setSessionId] = useState(defaultSessionId());
  const [objectId, setObjectId] = useState(defaultObjectId(stones));
  const [initialMessage, setInitialMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!objectId) setObjectId(defaultObjectId(stones));
  }, [objectId, stones]);

  return (
    <div className="stack">
      {stones.length === 0 && <div className="error">需要先创建至少一个 stone，才能选择入口 object。</div>}
      <input className="input" value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="session id" />
      <select className="input" value={objectId} onChange={(event) => setObjectId(event.target.value)} disabled={stones.length === 0}>
        {stones.map((stone) => <option key={stone.objectId} value={stone.objectId}>{stone.objectId}</option>)}
      </select>
      <textarea className="textarea" value={initialMessage} onChange={(event) => setInitialMessage(event.target.value)} placeholder="Initial message" />
      <Button className="primary" disabled={busy || !sessionId || !objectId} onClick={async () => {
        setBusy(true);
        try {
          await onCreate({ sessionId, objectId, initialMessage });
          setSessionId(defaultSessionId());
          setInitialMessage("");
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Creating…" : "Create session"}</Button>
    </div>
  );
}

