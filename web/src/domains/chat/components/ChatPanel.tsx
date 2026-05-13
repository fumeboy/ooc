import type { ThreadContext } from "..";
import { ChatComposer } from "./ChatComposer";
import { ThreadTimeline } from "./ThreadTimeline";

export function ChatPanel({ sessionId, objectId, thread, onSend }: { sessionId?: string; objectId?: string; thread?: ThreadContext; onSend: (text: string) => Promise<void> }) {
  return <div className="right-body section stack"><div className="row space-between"><strong>Root Thread</strong>{thread?.status && <span className="pill">{thread.status}</span>}</div>{sessionId && objectId ? <><ThreadTimeline thread={thread} /><ChatComposer onSend={onSend} /></> : <div className="empty">Select or create a session to chat.</div>}</div>;
}

