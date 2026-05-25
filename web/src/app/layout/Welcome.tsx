import { useLocation } from "react-router";
import { SessionCreator } from "../../domains/sessions/components/SessionCreator";
import type { Stone } from "../../domains/stones";
import { Card } from "../../shared/ui/card";

export function Welcome({
  stones,
  onCreateSession,
}: {
  stones: Stone[];
  onCreateSession?: (input: { sessionId: string; targetObjectId: string; initialMessage: string }) => Promise<void>;
}) {
  // H-3 (Round 5): 来自 UserThreadHome 的"Seed via welcome"按钮会带 `?session=<sid>`
  // query;读出来透给 SessionCreator 预填,用户不必复制粘贴 sessionId。
  const location = useLocation();
  const prefillSessionId = (() => {
    try {
      const qs = location.search.startsWith("?") ? location.search.slice(1) : location.search;
      const params = new URLSearchParams(qs);
      const sid = params.get("session");
      return sid ?? undefined;
    } catch {
      return undefined;
    }
  })();
  return (
    <div className="welcome-shell">
      <div className="welcome-stack">
        <div className="welcome-hero">
          <strong className="welcome-title">Welcome</strong>
          <div className="welcome-copy">
            Create your first session, or pick one from the sidebar to continue.
          </div>
        </div>

        <Card className="welcome-card">
          <div className="welcome-card-head">
            <strong>Create session</strong>
            <div className="muted small">
              Choose who you want to talk to and type your first message — we'll start a new session for you.
            </div>
          </div>
          {onCreateSession && (
            <SessionCreator
              stones={stones}
              onCreate={onCreateSession}
              initialSessionId={prefillSessionId}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
