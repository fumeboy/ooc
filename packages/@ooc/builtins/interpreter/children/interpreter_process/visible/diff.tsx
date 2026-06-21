/**
 * interpreter_process 的 visible/diff 组件 —— ts/js exec history 的版本 diff（本 class 自有）。
 *
 * history 按 execId 配对：
 *   added → 新增 exec（绿底 + code + output）
 *   unchanged → 灰色折叠
 *   changed（极罕见）→ 黄底 + fallback inline 显示
 */
import type { WindowDiffProps } from "@ooc/web/src/domains/sessions/components/window-diff/window-diff-props";
import {
  FieldDiffLine,
  Section,
  StatusBadge,
  asRecord,
  comparePrimitive,
  readArray,
  readString,
  rowStyle,
  type DiffStatus,
} from "@ooc/web/src/domains/sessions/components/window-diff-renderers/_shared";

type ExecLike = {
  execId?: string;
  language?: string;
  code?: string;
  output?: string;
  ok?: boolean;
  startedAt?: number;
};

function asExec(v: unknown): ExecLike {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  return {
    execId: typeof o.execId === "string" ? o.execId : undefined,
    language: typeof o.language === "string" ? o.language : undefined,
    code: typeof o.code === "string" ? o.code : undefined,
    output: typeof o.output === "string" ? o.output : undefined,
    ok: typeof o.ok === "boolean" ? o.ok : undefined,
    startedAt: typeof o.startedAt === "number" ? o.startedAt : undefined,
  };
}

function execStatus(prev: ExecLike | undefined, cur: ExecLike): DiffStatus {
  if (!prev) return "added";
  if (prev.code === cur.code && prev.output === cur.output && prev.ok === cur.ok)
    return "unchanged";
  return "changed";
}

export default function InterpreterProcessWindowDiff({ previous, current }: WindowDiffProps) {
  const prev = asRecord(previous);
  const cur = asRecord(current);

  const prevHistory = readArray(prev, "history").map(asExec);
  const curHistory = readArray(cur, "history").map(asExec);

  const prevById = new Map<string, ExecLike>();
  prevHistory.forEach((e) => {
    if (e.execId) prevById.set(e.execId, e);
  });
  const usedPrev = new Set<string>();

  const rows: React.ReactNode[] = [];
  curHistory.forEach((ce, i) => {
    let prevExec: ExecLike | undefined;
    if (ce.execId && prevById.has(ce.execId)) {
      prevExec = prevById.get(ce.execId);
      usedPrev.add(ce.execId);
    } else if (!ce.execId && i < prevHistory.length) {
      prevExec = prevHistory[i];
    }
    const status = execStatus(prevExec, ce);
    rows.push(
      <div key={`exec-${i}`} style={rowStyle(status)} data-diff-status={status} data-exec-id={ce.execId}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <strong>exec #{i}</strong>
          {ce.execId && <code className="muted small">{ce.execId}</code>}
          <span className="muted small">[{ce.language ?? "?"}]</span>
          {typeof ce.ok === "boolean" && (
            <span className="muted small">{ce.ok ? "ok" : "fail"}</span>
          )}
          <StatusBadge status={status} />
        </div>
        {ce.code && (
          <pre
            style={{
              margin: 0,
              fontSize: 11,
              padding: 4,
              background: "var(--background2)",
              borderRadius: 3,
              whiteSpace: "pre-wrap",
            }}
          >
            {ce.code.slice(0, 400)}
            {ce.code.length > 400 ? " …" : ""}
          </pre>
        )}
        {ce.output && (
          <pre
            style={{
              margin: "2px 0 0 0",
              fontSize: 11,
              padding: 4,
              background: "var(--background2)",
              borderRadius: 3,
              whiteSpace: "pre-wrap",
              opacity: 0.85,
            }}
          >
            {ce.output.slice(0, 400)}
            {ce.output.length > 400 ? " …" : ""}
          </pre>
        )}
      </div>,
    );
  });

  prevHistory.forEach((pe, i) => {
    if (pe.execId && usedPrev.has(pe.execId)) return;
    if (!pe.execId && i < curHistory.length) return;
    rows.push(
      <div
        key={`exec-removed-${i}`}
        style={rowStyle("removed")}
        data-diff-status="removed"
        data-exec-id={pe.execId}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <strong>exec #{i}</strong>
          {pe.execId && <code className="muted small">{pe.execId}</code>}
          <StatusBadge status="removed" />
        </div>
      </div>,
    );
  });

  return (
    <div data-testid="interpreter-process-window-diff">
      <Section title="interpreter_process fields" testId="interpreter-process-fields">
        <FieldDiffLine label="title" prev={readString(prev, "title")} cur={readString(cur, "title")} />
        <FieldDiffLine label="status" prev={readString(prev, "status")} cur={readString(cur, "status")} />
        <FieldDiffLine
          label="historyCount"
          prev={prevHistory.length}
          cur={curHistory.length}
          status={comparePrimitive(prevHistory.length, curHistory.length)}
        />
      </Section>
      <Section title="history" testId="interpreter-process-history">
        {rows.length === 0 ? <div className="muted small">(no history)</div> : rows}
      </Section>
    </div>
  );
}
