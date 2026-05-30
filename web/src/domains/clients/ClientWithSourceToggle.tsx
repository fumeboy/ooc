/**
 * ClientWithSourceToggle — (Batch 4 placeholder)
 * Full implementation in Batch 4 (secondary tabs).
 */
import { EmptyState } from "../../shared/ui/EmptyState";

export interface ClientTarget {
  kind: "stone" | "flow";
  objectId: string;
  sessionId?: string;
  page?: string;
}

/**
 * Match a file path to a client target (stone or flow).
 * Returns undefined if not a client entry point.
 */
export function matchClientTarget(path: string): ClientTarget | undefined {
  const stone = /^stones\/[^/]+\/objects\/([^/]+)\/client\/index\.tsx$/.exec(path);
  if (stone) return { kind: "stone", objectId: stone[1]! };
  const flow = /^flows\/([^/]+)\/objects\/([^/]+)\/client\/pages\/([A-Za-z0-9_-]+)\.tsx$/.exec(path);
  if (flow) return { kind: "flow", objectId: flow[2]!, sessionId: flow[1]!, page: flow[3]! };
  return undefined;
}

export function ClientWithSourceToggle({
  target,
}: {
  target: ClientTarget;
  sourcePath: string;
}) {
  return (
    <EmptyState
      title={`Object client: ${target.objectId}`}
      detail="(Batch 4) Object client renderer coming in Batch 4."
    />
  );
}
