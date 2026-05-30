/**
 * StoneFallback — shown when a stone has no custom client/index.tsx,
 * or when loading fails. Renders self.md / readme.md as a "name card".
 *
 * ooc-3 adaptation: paths updated to /api/stones/main/:name/self|readme.
 * Knowledge tree section points to stones/<name>/knowledge (no pool layer in ooc-3).
 */

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { MarkdownContent } from "../../shared/ui/MarkdownContent";
import { requestJson } from "../../transport/http";
import { fetchStones } from "../stones/query";
import { useDisplayName } from "../objects";

interface StoneFallbackProps {
  objectId: string;
  loadError?: { message: string; absPath: string };
}

type ExistenceState =
  | { loading: true }
  | { loading: false; exists: true }
  | { loading: false; exists: false };

function useStoneExists(objectId: string): ExistenceState {
  const [state, setState] = useState<ExistenceState>({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    fetchStones()
      .then((res) => {
        if (cancelled) return;
        const exists = (res.items ?? []).some((s) => s.objectId === objectId);
        setState({ loading: false, exists });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, exists: true });
      });
    return () => { cancelled = true; };
  }, [objectId]);
  return state;
}

export function StoneFallback({ objectId, loadError }: StoneFallbackProps) {
  const existence = useStoneExists(objectId);

  if (!existence.loading && !existence.exists) {
    return <StoneNotFoundCard objectId={objectId} />;
  }
  if (existence.loading) {
    return (
      <div className="stone-fallback" data-testid="stone-fallback-loading">
        <p className="muted small" style={{ padding: 24 }}>Loading…</p>
      </div>
    );
  }
  return <StoneFallbackBody objectId={objectId} loadError={loadError} />;
}

function StoneNotFoundCard({ objectId }: { objectId: string }) {
  return (
    <div className="stone-fallback" data-testid="stone-not-found">
      <header className="stone-fallback-header">
        <h1 className="stone-fallback-title">Stone not found</h1>
        <code className="stone-fallback-id" title={objectId}>{objectId}</code>
        <p className="stone-fallback-tagline muted small">
          No stone found with objectId <code>{objectId}</code> — it may have been deleted or the URL is misspelled.
        </p>
      </header>
      <div className="stone-fallback-entries" style={{ marginTop: 24, maxWidth: 480 }}>
        <Link to="/stones" className="stone-fallback-entry" data-testid="stone-not-found-back">
          <span className="stone-fallback-entry-label">← Browse all stones</span>
          <span className="muted small">/stones</span>
        </Link>
      </div>
    </div>
  );
}

function StoneFallbackBody({ objectId, loadError }: StoneFallbackProps) {
  const { displayName } = useDisplayName(objectId);
  const selfText = useStoneText(objectId, "self");
  const readmeText = useStoneText(objectId, "readme");

  return (
    <div className="stone-fallback">
      <header className="stone-fallback-header">
        <h1 className="stone-fallback-title">{displayName || objectId}</h1>
        <code className="stone-fallback-id" title={objectId}>{objectId}</code>
        <p className="stone-fallback-tagline muted small">
          OOC stone — an entity with identity (self.md) / public intro (readme.md) / can be talked to.
        </p>
      </header>

      <div className="stone-fallback-grid">
        <main className="stone-fallback-main">
          <CollapsibleSection
            label="Identity / self.md"
            sourceHint={`stones/main/objects/${objectId}/self.md`}
            defaultOpen
            loading={selfText.loading}
            empty={!selfText.loading && !selfText.text}
            emptyHint="self.md is empty — this stone has not written its identity yet."
          >
            {selfText.text && <MarkdownContent content={selfText.text} />}
          </CollapsibleSection>

          <CollapsibleSection
            label="About / readme.md"
            sourceHint={`stones/main/objects/${objectId}/readme.md`}
            defaultOpen
            loading={readmeText.loading}
            empty={!readmeText.loading && !readmeText.text}
            emptyHint="readme.md is empty — no public description yet."
          >
            {readmeText.text && <MarkdownContent content={readmeText.text} />}
          </CollapsibleSection>
        </main>

        <aside className="stone-fallback-aside">
          <div className="stone-fallback-entries">
            <h2 className="stone-fallback-entries-title">Entry points</h2>

            <Link
              to={`/files/stones/main/objects/${objectId}`}
              className="stone-fallback-entry"
              data-testid="entry-view-source"
            >
              <span className="stone-fallback-entry-label">View source files</span>
              <span className="muted small">stones/main/objects/{objectId}/</span>
            </Link>

            <Link
              to="/welcome"
              className="stone-fallback-entry"
              data-testid="entry-start-thread"
            >
              <span className="stone-fallback-entry-label">Start new thread</span>
              <span className="muted small">welcome page → select {objectId} as target</span>
            </Link>
          </div>
        </aside>
      </div>

      {loadError && (
        <details className="stone-fallback-error">
          <summary className="muted small">
            client/index.tsx load failed — path: <code>{loadError.absPath}</code>
          </summary>
          <pre className="stone-fallback-error-pre">{loadError.message}</pre>
        </details>
      )}
    </div>
  );
}

interface CollapsibleSectionProps {
  label: string;
  sourceHint: string;
  defaultOpen?: boolean;
  loading?: boolean;
  empty?: boolean;
  emptyHint?: string;
  children?: React.ReactNode;
}

function CollapsibleSection({
  label,
  sourceHint,
  defaultOpen = true,
  loading,
  empty,
  emptyHint,
  children,
}: CollapsibleSectionProps) {
  return (
    <details className="stone-fallback-section" open={defaultOpen}>
      <summary className="stone-fallback-section-summary">
        <span className="stone-fallback-section-label">{label}</span>
        <code className="stone-fallback-section-source muted small">{sourceHint}</code>
      </summary>
      <div className="stone-fallback-section-body">
        {loading ? (
          <p className="muted small">Loading…</p>
        ) : empty ? (
          <p className="muted small">{emptyHint ?? "No content yet."}</p>
        ) : (
          children
        )}
      </div>
    </details>
  );
}

interface TextState { text: string; loading: boolean }

function useStoneText(objectId: string, kind: "self" | "readme"): TextState {
  const [state, setState] = useState<TextState>({ text: "", loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ text: "", loading: true });
    // ooc-3: /api/stones/main/:name/self|readme; returns { content }
    const url = `/api/stones/main/${encodeURIComponent(objectId)}/${kind}`;
    requestJson<{ content?: string; text?: string }>(url)
      .then((res) => {
        if (cancelled) return;
        const text =
          typeof res?.content === "string"
            ? res.content
            : typeof res?.text === "string"
              ? res.text
              : "";
        setState({ text, loading: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ text: "", loading: false });
      });
    return () => { cancelled = true; };
  }, [objectId, kind]);
  return state;
}
