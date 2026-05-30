/**
 * ClientWithSourceToggle — renders an Object's custom client UI.
 *
 * ooc-3: Uses ObjectClientRenderer which calls GET /api/objects/:scope/:name/client-source-url
 * to resolve the /@fs/ URL. Falls back to StoneFallback if no client exists.
 *
 * The "source toggle" from ooc-2 is kept as a structural concept but simplified:
 * ooc-3 always tries dynamic loading; the stone self/readme fallback is the StoneFallback.
 */

import { ObjectClientRenderer, type ClientTarget as OcrTarget } from "./ObjectClientRenderer";
import { StoneFallback } from "./StoneFallback";

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
  // Convert ClientTarget to ObjectClientRenderer's ClientTarget type
  const ocrTarget: OcrTarget =
    target.kind === "stone"
      ? { scope: "stone", objectId: target.objectId }
      : {
          scope: "flow",
          objectId: target.objectId,
          sessionId: target.sessionId ?? "",
          page: target.page ?? "index",
        };

  // For stones: use ObjectClientRenderer which will try dynamic loading
  // and fall back to StoneFallback if no client file exists.
  if (target.kind === "stone") {
    return <ObjectClientRenderer target={ocrTarget} />;
  }

  // For flow objects: try ObjectClientRenderer; flow client pages are Batch 5 backend work
  if (target.sessionId && target.page) {
    return <ObjectClientRenderer target={ocrTarget} />;
  }

  // Fallback for stones without a custom client
  return <StoneFallback objectId={target.objectId} />;
}
