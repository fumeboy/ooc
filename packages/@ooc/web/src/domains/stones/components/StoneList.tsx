import type { Stone } from "..";

export function StoneList({ stones }: { stones: Stone[] }) {
  return <div className="stack">{stones.map((stone) => <div key={stone.objectId} className="list-button"><strong>{stone.objectId}</strong><div className="muted small">{stone.dir}</div></div>)}</div>;
}

