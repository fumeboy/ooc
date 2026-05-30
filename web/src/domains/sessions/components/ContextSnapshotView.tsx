/**
 * ContextSnapshotView — ooc-3 replacement for ooc-2's LoopDiffView + WindowDiffRow.
 *
 * Shows the defaultContext slices the LLM received for a given loop, and diffs them
 * against the previous loop's slices using 4-state semantics (added/changed/removed/unchanged).
 *
 * Semantic shift vs ooc-2:
 *   ooc-2: diffed contextWindows[] keyed by window id
 *   ooc-3: diffs DefaultContextSlice[] keyed by kind (at most one slice per kind per loop)
 *
 * Visual style reuses the same status colors as ooc-2's window-diff-renderers/_shared.tsx.
 */

import { useState } from "react";
import type { ContextSlice } from "./loop-types";
import { computeSliceDiff, describeSliceStatus, type SliceDiffEntry } from "./slice-diff.helpers";

/* ---- shared visual helpers (mirrors ooc-2 _shared.tsx approach) ---- */

type DiffStatus = "added" | "changed" | "removed" | "unchanged";

function statusBg(status: DiffStatus): string {
  switch (status) {
    case "added": return "rgba(216, 248, 232, .35)";
    case "removed": return "rgba(254, 226, 226, .35)";
    case "changed": return "rgba(253, 233, 214, .35)";
    case "unchanged": return "transparent";
  }
}

function statusBorder(status: DiffStatus): string {
  switch (status) {
    case "added": return "#b8efd5";
    case "removed": return "#fca5a5";
    case "changed": return "#f1c98e";
    case "unchanged": return "var(--border, rgba(255,255,255,0.1))";
  }
}

function StatusBadge({ status }: { status: DiffStatus }) {
  const { label, color } = describeSliceStatus(status);
  return (
    <span style={{
      fontSize: 10,
      padding: "1px 6px",
      borderRadius: 3,
      color,
      border: `1px solid ${statusBorder(status)}`,
      background: "var(--background, transparent)",
      marginLeft: 6,
      fontWeight: 500,
      fontFamily: "monospace",
    }}>
      {label}
    </span>
  );
}

/* ---- per-kind payload renderers (mirrors window-diff-renderers approach) ---- */

/** Render a plan slice: just a string payload. */
function PlanSliceBody({ payload }: { payload: unknown }) {
  if (typeof payload === "string") {
    return <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 11 }}>{payload}</pre>;
  }
  return <JsonBody payload={payload} />;
}

/** Render a todos slice: array of {id, content, done?} */
function TodosSliceBody({ payload }: { payload: unknown }) {
  if (!Array.isArray(payload) || payload.length === 0) {
    return <span className="muted small">(empty)</span>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11 }}>
      {(payload as Array<{ id?: string; content?: string; done?: boolean }>).map((item, i) => (
        <li key={item.id ?? i} style={{ marginBottom: 2, textDecoration: item.done ? "line-through" : undefined }}>
          <code className="muted small">{item.id}</code>{" "}
          {item.content ?? JSON.stringify(item)}
        </li>
      ))}
    </ul>
  );
}

/** Render self_identity: {title, description, body} */
function IdentitySliceBody({ payload }: { payload: unknown }) {
  if (!payload || typeof payload !== "object") return <JsonBody payload={payload} />;
  const p = payload as { title?: string; description?: string; body?: string };
  return (
    <div style={{ fontSize: 11 }}>
      {p.title && <div><strong>title:</strong> {p.title}</div>}
      {p.description && <div><strong>description:</strong> {p.description}</div>}
      {p.body && (
        <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", fontSize: 10, opacity: 0.8, maxHeight: 120, overflow: "auto" }}>
          {p.body}
        </pre>
      )}
    </div>
  );
}

/** Fallback: JSON dump */
function JsonBody({ payload }: { payload: unknown }) {
  return (
    <pre style={{ margin: 0, fontSize: 10, whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto", opacity: 0.85 }}>
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

function SlicePayloadBody({ kind, payload }: { kind: string; payload: unknown }) {
  switch (kind) {
    case "self_identity": return <IdentitySliceBody payload={payload} />;
    case "plan": return <PlanSliceBody payload={payload} />;
    case "todos": return <TodosSliceBody payload={payload} />;
    default: return <JsonBody payload={payload} />;
  }
}

/* ---- diff payload view: shows prev → cur for changed slices ---- */

function ChangedPayloadView({ kind, previous, current }: { kind: string; previous: unknown; current: unknown }) {
  return (
    <div>
      <div style={{ opacity: 0.6, marginBottom: 4, fontSize: 10, color: "var(--muted, #888)" }}>previous:</div>
      <div style={{ opacity: 0.6, marginBottom: 8, paddingLeft: 8, borderLeft: "2px solid var(--border, rgba(255,255,255,0.1))" }}>
        <SlicePayloadBody kind={kind} payload={previous} />
      </div>
      <div style={{ fontSize: 10, color: "var(--muted, #888)", marginBottom: 4 }}>current:</div>
      <div style={{ paddingLeft: 8, borderLeft: "2px solid #f1c98e" }}>
        <SlicePayloadBody kind={kind} payload={current} />
      </div>
    </div>
  );
}

/* ---- single slice row ---- */

function SliceDiffRow({ entry, defaultOpen }: { entry: SliceDiffEntry; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? entry.status !== "unchanged");
  const status = entry.status as DiffStatus;

  return (
    <div
      style={{
        borderRadius: 4,
        border: `1px solid ${statusBorder(status)}`,
        backgroundColor: statusBg(status),
        marginBottom: 6,
        overflow: "hidden",
      }}
      data-slice-kind={entry.kind}
      data-diff-status={entry.status}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "5px 8px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 12,
          fontFamily: "monospace",
          color: "var(--fg, #fff)",
        }}
      >
        <span style={{ opacity: 0.5, fontSize: 10 }}>{open ? "▼" : "▶"}</span>
        <strong style={{ fontSize: 11 }}>{entry.kind}</strong>
        <StatusBadge status={status} />
      </button>
      {open && (
        <div style={{ padding: "4px 10px 8px", borderTop: `1px solid ${statusBorder(status)}` }}>
          {entry.status === "changed" && entry.previous && entry.current ? (
            <ChangedPayloadView
              kind={entry.kind}
              previous={entry.previous.payload}
              current={entry.current.payload}
            />
          ) : entry.status === "removed" && entry.previous ? (
            <div style={{ opacity: 0.6, textDecoration: "line-through" }}>
              <SlicePayloadBody kind={entry.kind} payload={entry.previous.payload} />
            </div>
          ) : entry.current ? (
            <SlicePayloadBody kind={entry.kind} payload={entry.current.payload} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---- top-level component ---- */

export interface ContextSnapshotViewProps {
  /** Slices for the current loop. */
  currentSlices: ContextSlice[] | null | undefined;
  /** Slices for the previous loop (loop N-1). Pass undefined/null for loop 0. */
  previousSlices: ContextSlice[] | null | undefined;
  /** Loop index (0-based) shown in header. */
  loopIndex: number;
}

/**
 * Context snapshot viewer for a single loop.
 *
 * Shows each defaultContext slice as a collapsible row with diff highlighting vs the previous loop.
 * The 4-state diff (added/changed/removed/unchanged) mirrors ooc-2's WindowDiffRow behavior.
 */
export function ContextSnapshotView({ currentSlices, previousSlices, loopIndex }: ContextSnapshotViewProps) {
  const diffEntries = computeSliceDiff(currentSlices, previousSlices);

  if (diffEntries.length === 0) {
    return (
      <div style={{ padding: 12, color: "var(--muted, #888)", fontSize: 12, textAlign: "center" }}>
        {currentSlices === null
          ? "No context snapshot captured for this loop. Run with OOC_DEBUG_LOOPS=1 to enable."
          : "No context slices in this loop."}
      </div>
    );
  }

  const changed = diffEntries.filter((e) => e.status !== "unchanged").length;
  const summary = changed === 0
    ? "no changes from previous loop"
    : `${changed} slice${changed !== 1 ? "s" : ""} changed`;

  return (
    <div className="context-snapshot-view" style={{ padding: "8px 10px", fontSize: 12 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
        paddingBottom: 6,
        borderBottom: "1px solid var(--border, rgba(255,255,255,0.1))",
      }}>
        <span style={{ fontWeight: 600, fontFamily: "monospace", fontSize: 11 }}>
          Loop #{String(loopIndex).padStart(4, "0")} context
        </span>
        <span style={{ color: "var(--muted, #888)", fontSize: 10 }}>
          {diffEntries.length} slice{diffEntries.length !== 1 ? "s" : ""} · {summary}
        </span>
        {loopIndex === 0 && (
          <span style={{ fontSize: 10, color: "var(--muted, #888)" }}>
            (loop 0: all slices shown as added)
          </span>
        )}
      </div>
      {diffEntries.map((entry) => (
        <SliceDiffRow key={entry.kind} entry={entry} />
      ))}
    </div>
  );
}
