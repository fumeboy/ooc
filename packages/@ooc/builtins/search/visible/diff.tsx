/**
 * search/visible/diff.tsx — search 窗的 visible/diff 组件。
 *
 * 逻辑来自 packages/@ooc/web/src/domains/sessions/components/window-diff-renderers/SearchWindowDiff.tsx，
 * 签名收敛到 WindowDiffProps ({previous, current})，删去 windowId 引用。
 *
 * Diff 形态：
 *   - query 字段 diff
 *   - matches 集合按 path + line 配对
 *       新命中 → 绿底
 *       移除命中 → strike
 *       snippet 变化 → 黄底 + inline diff
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

type MatchLike = { path?: string; line?: number; snippet?: string };

function asMatch(v: unknown): MatchLike {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  return {
    path: typeof o.path === "string" ? o.path : undefined,
    line: typeof o.line === "number" ? o.line : undefined,
    snippet: typeof o.snippet === "string" ? o.snippet : undefined,
  };
}

function matchKey(m: MatchLike): string {
  return `${m.path ?? ""}:${m.line ?? ""}`;
}

export default function SearchWindowDiff({ previous, current }: WindowDiffProps) {
  const prev = asRecord(previous);
  const cur = asRecord(current);

  const prevMatches = readArray(prev, "matches").map(asMatch);
  const curMatches = readArray(cur, "matches").map(asMatch);

  const prevByKey = new Map<string, MatchLike>();
  prevMatches.forEach((m) => prevByKey.set(matchKey(m), m));
  const usedPrevKeys = new Set<string>();

  const rows: React.ReactNode[] = [];

  curMatches.forEach((m, i) => {
    const key = matchKey(m);
    const prevM = prevByKey.get(key);
    let status: DiffStatus = "added";
    if (prevM) {
      usedPrevKeys.add(key);
      status = comparePrimitive(prevM.snippet, m.snippet);
    }
    rows.push(
      <div key={`m-${i}`} style={rowStyle(status)} data-diff-status={status} data-match-path={m.path}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <code style={{ fontWeight: 500 }}>{m.path ?? "(no path)"}</code>
          {typeof m.line === "number" && (
            <span className="muted small">:{m.line}</span>
          )}
          <StatusBadge status={status} />
        </div>
        {m.snippet && (
          <div style={{ marginTop: 2, fontFamily: "monospace" }}>
            {prevM && status === "changed" ? (
              <>
                <div style={{ textDecoration: "line-through", opacity: 0.7 }}>
                  {prevM.snippet ?? ""}
                </div>
                <div>{m.snippet}</div>
              </>
            ) : (
              <span>{m.snippet}</span>
            )}
          </div>
        )}
      </div>,
    );
  });

  prevMatches.forEach((m, i) => {
    const key = matchKey(m);
    if (usedPrevKeys.has(key)) return;
    rows.push(
      <div
        key={`removed-${i}`}
        style={rowStyle("removed")}
        data-diff-status="removed"
        data-match-path={m.path}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <code style={{ fontWeight: 500 }}>{m.path ?? "(no path)"}</code>
          {typeof m.line === "number" && (
            <span className="muted small">:{m.line}</span>
          )}
          <StatusBadge status="removed" />
        </div>
        {m.snippet && <div style={{ marginTop: 2 }}>{m.snippet}</div>}
      </div>,
    );
  });

  return (
    <div data-testid="search-window-diff">
      <Section title="query" testId="search-fields">
        <FieldDiffLine label="kind" prev={readString(prev, "kind")} cur={readString(cur, "kind")} />
        <FieldDiffLine label="query" prev={readString(prev, "query")} cur={readString(cur, "query")} />
        <FieldDiffLine label="status" prev={readString(prev, "status")} cur={readString(cur, "status")} />
      </Section>
      <Section
        title={`matches (${curMatches.length} cur · ${prevMatches.length} prev)`}
        testId="search-matches"
      >
        {rows.length === 0 ? <div className="muted small">(no matches)</div> : rows}
      </Section>
    </div>
  );
}
