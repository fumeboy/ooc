import type { ContextSnapshot } from "../snapshot.js";

/**
 * TraceRenderer — human-readable debug output answering "why are these windows in my context?".
 *
 * Output format is plain text, suitable for console / debug API responses.
 * Lists each window with its provenance, relevance score, and matched intent.
 */
export class TraceRenderer {
  render(snapshot: ContextSnapshot): string {
    const lines: string[] = [];
    lines.push(`=== Context Trace for thread ${snapshot.thread.id} (status: ${snapshot.thread.status}) ===`);
    lines.push(`self: ${snapshot.self.objectId}`);
    lines.push(`windows in-context: ${snapshot.windows.length}, overflow: ${snapshot.overflow.length}`);
    lines.push("");

    lines.push("--- Windows (by relevance) ---");
    const sorted = [...snapshot.windows].sort((a, b) => {
      const sa = a.relevance?.score ?? (a.provenance?.kind === "explicit" ? 1.0 : 0.7);
      const sb = b.relevance?.score ?? (b.provenance?.kind === "explicit" ? 1.0 : 0.7);
      return sb - sa;
    });
    for (const w of sorted) {
      const score = w.relevance?.score?.toFixed(2) ?? "n/a";
      const kind = w.provenance?.kind ?? "unknown";
      const mechanism = w.provenance?.reason.mechanism ?? "n/a";
      const source = w.provenance?.reason.sourceId ?? "n/a";
      const bound = w.boundFormId ? ` bound_to=${w.boundFormId}` : "";
      const trace = snapshot.trace.perWindow[w.id];
      const producer = trace?.producedBy ?? "n/a";
      lines.push(`  [${score}] ${w.id} (type=${w.type}, title="${w.title}")`);
      lines.push(`      provenance: kind=${kind}, mechanism=${mechanism}, source=${source}${bound}`);
      lines.push(`      producedBy: ${producer}`);
    }

    if (snapshot.overflow.length > 0) {
      lines.push("");
      lines.push("--- Overflow (budget) ---");
      for (const o of snapshot.overflow) {
        lines.push(`  [${o.relevance.toFixed(2)}] ${o.id} title="${o.title}" reason=${o.reason}`);
      }
    }

    if (Object.keys(snapshot.trace.intents).length > 0) {
      lines.push("");
      lines.push("--- Intent Cache ---");
      for (const [formId, intents] of Object.entries(snapshot.trace.intents)) {
        lines.push(`  ${formId}: ${intents.map(i => i.name).join(", ") || "(none)"}`);
      }
    }

    return lines.join("\n");
  }
}
