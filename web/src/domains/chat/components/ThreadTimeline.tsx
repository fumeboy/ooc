import { formatThread, type ThreadContext } from "..";
import { TuiBlock } from "./TuiBlock";

export function ThreadTimeline({ thread }: { thread?: ThreadContext }) {
  const lines = formatThread(thread);
  if (lines.length === 0) return <div className="muted small">No thread messages yet.</div>;
  return <div className="stack tui-thread">{lines.map((line) => <TuiBlock key={line.id} line={line} />)}</div>;
}
