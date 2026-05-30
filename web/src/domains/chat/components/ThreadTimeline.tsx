import { useEffect, useMemo, useRef } from "react";
import { formatOoc3Thread } from "../formatOoc3Thread";
import type { ThreadContext } from "../model";
import { TuiBlock } from "./TuiBlock";

export function ThreadTimeline({
  thread,
  sessionId,
  objectId,
  threadId,
}: {
  thread?: ThreadContext;
  sessionId?: string;
  objectId?: string;
  threadId?: string;
}) {
  const lines = useMemo(() => formatOoc3Thread(thread?._ooc3Thread), [thread]);

  // Scroll to bottom when new messages arrive
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  // ooc-3 has no contextWindows; pass empty Set so TuiBlock hides window link buttons
  const liveWindowIds = useMemo(() => new Set<string>(), []);

  if (lines.length === 0) {
    return <div className="muted small">No thread messages yet.</div>;
  }
  return (
    <div className="stack tui-thread">
      {lines.map((line) => (
        <TuiBlock
          key={line.id}
          line={line}
          liveWindowIds={liveWindowIds}
          sessionId={sessionId}
          objectId={objectId}
          threadId={threadId}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
