import { formatThread, type ThreadContext } from "..";

export function ThreadTimeline({ thread }: { thread?: ThreadContext }) {
  const lines = formatThread(thread);
  if (lines.length === 0) return <div className="muted small">No thread messages yet.</div>;
  return <div className="stack">{lines.map((line) => <div key={line.id} className={`message ${line.role}`}><div className="message-role">{line.role}</div><pre className="message-json">{line.content}</pre></div>)}</div>;
}

