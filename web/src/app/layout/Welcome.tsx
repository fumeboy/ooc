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
          {onCreateSession && <SessionCreator stones={stones} onCreate={onCreateSession} />}
        </Card>
      </div>
    </div>
  );
}
