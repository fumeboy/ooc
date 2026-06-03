import type { ContextSnapshot } from "../snapshot.js";

/**
 * JsonRenderer — structured output for frontend / debug API.
 *
 * Unlike XmlRenderer, the JSON output is type-safe and designed for programmatic
 * consumption (ContextSnapshotViewer in web, /api/threads/:id/context endpoint).
 */
export class JsonRenderer {
  render(snapshot: ContextSnapshot): unknown {
    return JSON.parse(JSON.stringify(snapshot));
  }

  renderString(snapshot: ContextSnapshot, pretty: boolean = false): string {
    return JSON.stringify(snapshot, null, pretty ? 2 : 0);
  }
}
