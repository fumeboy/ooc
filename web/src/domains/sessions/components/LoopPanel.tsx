/**
 * LoopPanel — Loop debug visualizer for ooc-3 (Batch 5).
 *
 * Shows all LLM loop iterations for a thread:
 *   - List of loop entries with meta (latency, message count, tool calls)
 *   - Expandable detail view showing input/output for a selected loop
 *   - Debug enable/disable toggle
 *
 * Data sources:
 *   - GET /api/runtime/flows/:s/objects/:o/threads/:t/debug/loops (list)
 *   - GET /api/runtime/flows/:s/objects/:o/threads/:t/debug/loops/:i (detail)
 *   - GET /api/runtime/debug/status (toggle state)
 *   - POST /api/runtime/debug/enable / /disable (toggle)
 */

import { useCallback, useEffect, useState } from "react";
import { requestJson } from "../../../transport/http";
import { endpoints } from "../../../transport/endpoints";
import type { LoopListEntry, LoopDebugRecord, ContextSlice } from "./loop-types";
import { ContextSnapshotView } from "./ContextSnapshotView";

interface LoopPanelProps {
  sessionId: string;
  objectId: string;
  threadId: string;
}

interface DebugStatusResponse {
  ok: boolean;
  enabled: boolean;
}

interface ListLoopsResponse {
  ok: boolean;
  loops: LoopListEntry[];
}

interface LoopDetailResponse {
  ok: boolean;
  loopIndex: number;
  input: unknown;
  output: unknown;
  meta: unknown;
  contextSlices: ContextSlice[] | null;
}

function formatLatency(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "--";
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return "--";
  }
}

function LoopEntry({
  entry,
  isSelected,
  onSelect,
}: {
  entry: LoopListEntry;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const meta = entry.meta;
  const statusColor =
    meta?.status === "ok"
      ? "var(--ok, #4caf50)"
      : meta?.status === "error"
        ? "var(--error, #f44336)"
        : "var(--muted, #888)";

  return (
    <button
      type="button"
      className={`loop-entry${isSelected ? " is-selected" : ""}`}
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        width: "100%",
        textAlign: "left",
        background: isSelected ? "var(--active-bg, rgba(255,255,255,0.06))" : "transparent",
        border: "none",
        borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))",
        cursor: "pointer",
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      <span style={{ color: statusColor, minWidth: 8 }}>●</span>
      <span style={{ minWidth: 48, color: "var(--fg, #fff)" }}>
        #{String(entry.loopIndex).padStart(4, "0")}
      </span>
      {meta && (
        <>
          <span style={{ color: "var(--muted, #888)", minWidth: 60 }}>
            {formatTime(meta.startedAt)}
          </span>
          <span style={{ color: "var(--muted, #888)", minWidth: 50 }}>
            {formatLatency(meta.latencyMs)}
          </span>
          <span style={{ color: "var(--muted, #888)", minWidth: 60 }}>
            {meta.messageCount}msg
          </span>
          <span style={{ color: "var(--muted, #888)" }}>
            {meta.toolCallCount}tools
          </span>
        </>
      )}
    </button>
  );
}

type DetailTab = "context" | "meta" | "raw";

function LoopDetail({ detail }: { detail: LoopDebugRecord & { _prevContextSlices?: ContextSlice[] | null } }) {
  const [tab, setTab] = useState<DetailTab>("context");
  const [showInput, setShowInput] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  const hasContext = detail.contextSlices !== null;

  return (
    <div className="loop-detail" style={{ fontFamily: "monospace", fontSize: 12, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Sub-tab bar */}
      <div style={{
        display: "flex",
        gap: 4,
        padding: "4px 10px",
        borderBottom: "1px solid var(--border, rgba(255,255,255,0.1))",
        flexShrink: 0,
      }}>
        <button
          type="button"
          onClick={() => setTab("context")}
          style={{
            fontSize: 11,
            padding: "2px 8px",
            background: tab === "context" ? "var(--active-bg, rgba(255,255,255,0.12))" : "none",
            border: tab === "context" ? "1px solid var(--border, rgba(255,255,255,0.2))" : "1px solid transparent",
            borderRadius: 3,
            cursor: "pointer",
            color: hasContext ? "var(--fg, #fff)" : "var(--muted, #888)",
          }}
        >
          Context {!hasContext && "(no data)"}
        </button>
        <button
          type="button"
          onClick={() => setTab("meta")}
          style={{
            fontSize: 11,
            padding: "2px 8px",
            background: tab === "meta" ? "var(--active-bg, rgba(255,255,255,0.12))" : "none",
            border: tab === "meta" ? "1px solid var(--border, rgba(255,255,255,0.2))" : "1px solid transparent",
            borderRadius: 3,
            cursor: "pointer",
            color: "var(--fg, #fff)",
          }}
        >
          Meta
        </button>
        <button
          type="button"
          onClick={() => setTab("raw")}
          style={{
            fontSize: 11,
            padding: "2px 8px",
            background: tab === "raw" ? "var(--active-bg, rgba(255,255,255,0.12))" : "none",
            border: tab === "raw" ? "1px solid var(--border, rgba(255,255,255,0.2))" : "1px solid transparent",
            borderRadius: 3,
            cursor: "pointer",
            color: "var(--fg, #fff)",
          }}
        >
          Raw
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Context tab — the main new view */}
        {tab === "context" && (
          <ContextSnapshotView
            currentSlices={detail.contextSlices}
            previousSlices={detail._prevContextSlices}
            loopIndex={detail.loopIndex}
          />
        )}

        {/* Meta tab */}
        {tab === "meta" && (
          <div style={{ padding: 12 }}>
            {detail.meta ? (
              <div className="loop-meta">
                <div className="muted small" style={{ marginBottom: 4 }}>
                  Loop #{String(detail.loopIndex).padStart(4, "0")} meta
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  <div><span className="muted">latency</span> {formatLatency(detail.meta.latencyMs)}</div>
                  <div><span className="muted">status</span> {detail.meta.status}</div>
                  <div><span className="muted">messages</span> {detail.meta.messageCount}</div>
                  <div><span className="muted">tool calls</span> {detail.meta.toolCallCount}</div>
                  <div><span className="muted">ctx bytes</span> {detail.meta.contextBytes}</div>
                  <div><span className="muted">result bytes</span> {detail.meta.resultTextBytes}</div>
                  {detail.meta.model && (
                    <div style={{ gridColumn: "1/-1" }}><span className="muted">model</span> {detail.meta.model}</div>
                  )}
                  {detail.meta.error && (
                    <div style={{ gridColumn: "1/-1", color: "var(--error, #f44336)" }}>
                      <span className="muted">error</span> {detail.meta.error}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <span className="muted small">No meta available</span>
            )}
          </div>
        )}

        {/* Raw tab — input/output JSON dumps */}
        {tab === "raw" && (
          <div style={{ padding: 12 }}>
            {detail.input && (
              <div style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowInput((v) => !v)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent, #7eb8f7)", fontSize: 12, padding: 0 }}
                >
                  {showInput ? "▼" : "▶"} Input ({(detail.input as { inputItems?: unknown[] }).inputItems?.length ?? 0} items)
                </button>
                {showInput && (
                  <pre style={{
                    margin: "4px 0 0",
                    padding: 8,
                    background: "var(--code-bg, rgba(0,0,0,0.3))",
                    overflow: "auto",
                    maxHeight: 300,
                    fontSize: 11,
                    borderRadius: 4,
                  }}>
                    {JSON.stringify(detail.input, null, 2)}
                  </pre>
                )}
              </div>
            )}
            {detail.output && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowOutput((v) => !v)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent, #7eb8f7)", fontSize: 12, padding: 0 }}
                >
                  {showOutput ? "▼" : "▶"} Output ({(detail.output as { outputItems?: unknown[] }).outputItems?.length ?? 0} items)
                </button>
                {showOutput && (
                  <pre style={{
                    margin: "4px 0 0",
                    padding: 8,
                    background: "var(--code-bg, rgba(0,0,0,0.3))",
                    overflow: "auto",
                    maxHeight: 300,
                    fontSize: 11,
                    borderRadius: 4,
                  }}>
                    {JSON.stringify(detail.output, null, 2)}
                  </pre>
                )}
              </div>
            )}
            {!detail.input && !detail.output && (
              <span className="muted small">No raw input/output available</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function LoopPanel({ sessionId, objectId, threadId }: LoopPanelProps) {
  const [loops, setLoops] = useState<LoopListEntry[]>([]);
  const [debugEnabled, setDebugEnabled] = useState<boolean | null>(null);
  const [selectedLoop, setSelectedLoop] = useState<number | null>(null);
  const [detail, setDetail] = useState<(LoopDebugRecord & { _prevContextSlices?: ContextSlice[] | null }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLoops = useCallback(async () => {
    if (!sessionId || !objectId || !threadId) return;
    setLoading(true);
    setError(null);
    try {
      const [statusRes, loopsRes] = await Promise.all([
        requestJson<DebugStatusResponse>(endpoints.runtimeDebugStatus),
        requestJson<ListLoopsResponse>(
          endpoints.runtimeListLoops(sessionId, objectId, threadId),
        ),
      ]);
      if (statusRes.ok) setDebugEnabled(statusRes.enabled);
      if (loopsRes.ok) setLoops(loopsRes.loops ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, objectId, threadId]);

  useEffect(() => {
    void fetchLoops();
  }, [fetchLoops]);

  const handleSelectLoop = useCallback(async (loopIndex: number) => {
    setSelectedLoop(loopIndex);
    setDetailLoading(true);
    try {
      const res = await requestJson<LoopDetailResponse>(
        endpoints.runtimeGetLoopDebug(sessionId, objectId, threadId, loopIndex),
      );
      if (res.ok) {
        // Also fetch previous loop's context for diffing (best-effort; non-fatal if loop 0)
        let prevContextSlices: ContextSlice[] | null = null;
        if (loopIndex > 0) {
          try {
            const prevRes = await requestJson<LoopDetailResponse>(
              endpoints.runtimeGetLoopDebug(sessionId, objectId, threadId, loopIndex - 1),
            );
            if (prevRes.ok) prevContextSlices = prevRes.contextSlices;
          } catch {
            // prev loop may not exist — leave null
          }
        }
        setDetail({
          loopIndex: res.loopIndex,
          input: res.input as LoopDebugRecord["input"],
          output: res.output as LoopDebugRecord["output"],
          meta: res.meta as LoopDebugRecord["meta"],
          contextSlices: res.contextSlices,
          _prevContextSlices: prevContextSlices,
        } as LoopDebugRecord & { _prevContextSlices: ContextSlice[] | null });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, [sessionId, objectId, threadId]);

  const handleToggleDebug = useCallback(async () => {
    try {
      const url = debugEnabled
        ? endpoints.runtimeDebugDisable
        : endpoints.runtimeDebugEnable;
      const res = await requestJson<DebugStatusResponse>(url, { method: "POST" });
      if (res.ok) {
        setDebugEnabled(res.enabled);
        if (res.enabled) void fetchLoops();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [debugEnabled, fetchLoops]);

  return (
    <div className="loop-panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 12px",
        borderBottom: "1px solid var(--border, rgba(255,255,255,0.1))",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Loop Debug</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {debugEnabled !== null && (
            <span style={{
              fontSize: 11,
              color: debugEnabled ? "var(--ok, #4caf50)" : "var(--muted, #888)",
            }}>
              {debugEnabled ? "● capturing" : "○ off"}
            </span>
          )}
          <button
            type="button"
            onClick={handleToggleDebug}
            style={{
              fontSize: 11,
              padding: "2px 8px",
              background: "var(--btn-bg, rgba(255,255,255,0.08))",
              border: "1px solid var(--border, rgba(255,255,255,0.15))",
              borderRadius: 3,
              cursor: "pointer",
              color: "var(--fg, #fff)",
            }}
          >
            {debugEnabled ? "Disable" : "Enable"}
          </button>
          <button
            type="button"
            onClick={() => void fetchLoops()}
            style={{
              fontSize: 11,
              padding: "2px 8px",
              background: "var(--btn-bg, rgba(255,255,255,0.08))",
              border: "1px solid var(--border, rgba(255,255,255,0.15))",
              borderRadius: 3,
              cursor: "pointer",
              color: "var(--fg, #fff)",
            }}
          >
            ↻
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 8, color: "var(--error, #f44336)", fontSize: 12 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ padding: 8, color: "var(--muted, #888)", fontSize: 12 }}>
          Loading…
        </div>
      )}

      {!loading && loops.length === 0 && (
        <div style={{ padding: 16, color: "var(--muted, #888)", fontSize: 12, textAlign: "center" }}>
          {debugEnabled === false
            ? "Debug capture is off. Enable it above, then run a new LLM call."
            : "No loop debug records yet for this thread."}
        </div>
      )}

      {loops.length > 0 && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Loop list */}
          <div style={{
            width: 280,
            flexShrink: 0,
            borderRight: "1px solid var(--border, rgba(255,255,255,0.1))",
            overflowY: "auto",
          }}>
            {loops.map((entry) => (
              <LoopEntry
                key={entry.loopIndex}
                entry={entry}
                isSelected={entry.loopIndex === selectedLoop}
                onSelect={() => void handleSelectLoop(entry.loopIndex)}
              />
            ))}
          </div>

          {/* Detail pane */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {detailLoading && (
              <div style={{ padding: 16, color: "var(--muted, #888)", fontSize: 12 }}>
                Loading…
              </div>
            )}
            {!detailLoading && detail && detail.loopIndex === selectedLoop && (
              <LoopDetail detail={detail} />
            )}
            {!detailLoading && selectedLoop === null && (
              <div style={{ padding: 16, color: "var(--muted, #888)", fontSize: 12, textAlign: "center" }}>
                Select a loop to inspect
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
