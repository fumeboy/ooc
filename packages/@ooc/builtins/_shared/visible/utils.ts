/**
 * Shared UI utilities used by builtin object visible components.
 *
 * These are extracted from ContextSnapshotViewer.tsx so both the web package
 * and builtin packages can import them without circular dependency issues.
 */

export type Tone = "info" | "warning" | "success" | "error" | "neutral";

export function statusToTone(status?: string): Tone {
  switch (status) {
    case "running":
    case "open":
    case "active":
      return "info";
    case "executing":
      return "warning";
    case "success":
    case "done":
      return "success";
    case "failed":
    case "archived":
      return "error";
    default:
      return "neutral";
  }
}

export function previewText(value: string, limit = 88): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (!singleLine) return "(empty)";
  if (singleLine.length <= limit) return singleLine;
  return `${singleLine.slice(0, limit)}…`;
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
