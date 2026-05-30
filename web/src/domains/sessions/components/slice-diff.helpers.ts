/**
 * slice-diff.helpers — ooc-3 equivalent of ooc-2's window-diff.helpers.
 *
 * Diffs defaultContext slices between adjacent loops using the same 4-state semantic:
 *   added     : kind appeared in current but not previous
 *   removed   : kind was in previous but not in current
 *   changed   : same kind, payload JSON differs
 *   unchanged : same kind, same payload JSON
 *
 * Key difference from ooc-2: slices are keyed by `kind` (not by `id`), and there is at
 * most one slice per kind per loop (the backend sorts, deduplicates by kind).
 *
 * Mirrors computeWindowDiff semantics — front-end callers can reason the same way.
 */

import type { ContextSlice } from "./loop-types";

export type SliceDiffStatus = "added" | "changed" | "removed" | "unchanged";

export interface SliceDiffEntry {
  kind: string;
  status: SliceDiffStatus;
  /** Slice from the current loop; undefined if removed. */
  current?: ContextSlice;
  /** Slice from the previous loop; undefined if added. */
  previous?: ContextSlice;
}

/**
 * Compute a slice-level diff between current loop and previous loop.
 *
 * Returns order: kinds present in current (in their order) + removed kinds appended last.
 *
 * Edge cases:
 *   current null/undefined  → empty array (no snapshot data captured)
 *   previous null/undefined → all current slices are "added" (loop 0 or no prior capture)
 */
export function computeSliceDiff(
  current: ContextSlice[] | null | undefined,
  previous: ContextSlice[] | null | undefined,
): SliceDiffEntry[] {
  if (!Array.isArray(current)) return [];

  const prevList = Array.isArray(previous) ? previous : [];
  const prevByKind = new Map<string, ContextSlice>();
  for (const s of prevList) {
    if (s && typeof s.kind === "string") prevByKind.set(s.kind, s);
  }

  const seenKinds = new Set<string>();
  const result: SliceDiffEntry[] = [];

  for (const cur of current) {
    if (!cur || typeof cur.kind !== "string") continue;
    seenKinds.add(cur.kind);
    const prev = prevByKind.get(cur.kind);

    if (!prev) {
      result.push({ kind: cur.kind, status: "added", current: cur });
      continue;
    }

    const samePayload = JSON.stringify(cur.payload) === JSON.stringify(prev.payload);
    result.push({
      kind: cur.kind,
      status: samePayload ? "unchanged" : "changed",
      current: cur,
      previous: prev,
    });
  }

  // Append kinds that were in previous but missing in current → removed
  for (const prev of prevList) {
    if (!prev || typeof prev.kind !== "string") continue;
    if (seenKinds.has(prev.kind)) continue;
    result.push({ kind: prev.kind, status: "removed", previous: prev });
  }

  return result;
}

/**
 * Mapping from slice status to visual tokens.
 * Mirrors describeDiffStatus from ooc-2's window-diff.helpers.
 */
export function describeSliceStatus(status: SliceDiffStatus): {
  label: string;
  className: string;
  color: string;
} {
  switch (status) {
    case "added":
      return { label: "+ added", className: "added", color: "#238d61" };
    case "changed":
      return { label: "~ changed", className: "changed", color: "#a35a14" };
    case "removed":
      return { label: "− removed", className: "removed", color: "#b91c1c" };
    case "unchanged":
      return { label: "· unchanged", className: "unchanged", color: "var(--muted, #888)" };
  }
}
