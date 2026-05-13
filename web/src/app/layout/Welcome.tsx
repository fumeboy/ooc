import { SessionCreator } from "../../domains/sessions/components/SessionCreator";
import type { Stone } from "../../domains/stones";
import { Card } from "../../shared/ui/card";

export function Welcome({
  stones,
  onCreateSession,
}: {
  stones: Stone[];
  onCreateSession?: (input: { sessionId: string; objectId: string; initialMessage?: string }) => Promise<void>;
}) {
  return (
    <div className="welcome-shell">
      <div className="welcome-stack">
        <div className="welcome-hero">
          <strong className="welcome-title">Welcome</strong>
          <div className="welcome-copy">
            Create or continue a flow session from the left sidebar, then inspect files and root thread activity from this control surface.
          </div>
        </div>

        <Card className="welcome-card">
          <div className="welcome-card-head">
            <strong>Create session</strong>
            <div className="muted small">Choose an entry object and optional initial message to create the next flow.</div>
          </div>
          {onCreateSession && <SessionCreator stones={stones} onCreate={onCreateSession} />}
        </Card>
      </div>
    </div>
  );
}
