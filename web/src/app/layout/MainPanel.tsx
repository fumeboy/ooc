import type { FileContent } from "../../domains/files";
import { FileViewer } from "../../domains/files/components/FileViewer";
import { SessionCreator } from "../../domains/sessions/components/SessionCreator";
import type { Stone } from "../../domains/stones";

export function MainPanel({ isWelcome = false, stones = [], onCreateSession, file, path, error, loading, editableFile, savingFile, onFileChange, onFileSave }: { isWelcome?: boolean; stones?: Stone[]; onCreateSession?: (input: { sessionId: string; objectId: string; initialMessage?: string }) => Promise<void>; file?: FileContent; path?: string; error?: string; loading: boolean; editableFile?: boolean; savingFile?: boolean; onFileChange?: (content: string) => void; onFileSave?: () => void }) {
  const showBlockingError = Boolean(error && file);
  return (
    <main className="main-panel gap-1">
      <div className="breadcrumb-bar min-h-6 rounded-md">
        <span>{isWelcome ? "flows › welcome" : path ? path.split("/").join(" › ") : "flows › hi › objects › supervisor › threads › root"}</span>
        <span className="refresh">↻</span>
      </div>
      <div className="panel flex flex-col flex-grow">
        <div className="content-tabs">
          <strong>{isWelcome ? "Welcome" : path?.split("/").at(-1) ?? "OOC World"}</strong>
          <span className="muted small">{isWelcome ? "create a session to enter the control loop" : file ? `${file.size} chars` : "flows / stones / files"}</span>
          {loading && <span className="pill">loading</span>}
          {!isWelcome && editableFile && <span className="pill">codemirror</span>}
          {error && !file && !isWelcome && <span className="muted small">backend offline</span>}
        </div>
        <div className="main-body">
          {showBlockingError && <div className="section compact"><div className="error">{error}</div></div>}
          {isWelcome ? (
            <div className="section" style={{ minHeight: "100%", display: "grid", placeItems: "center" }}>
              <div style={{ width: "min(560px, 100%)", display: "grid", gap: 18 }}>
                <div style={{ display: "grid", gap: 8, textAlign: "center" }}>
                  <strong style={{ fontSize: 26, lineHeight: 1.2 }}>Welcome</strong>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Create or continue a flow session from the left sidebar, then inspect files and root thread activity from this control surface.
                  </div>
                </div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "rgba(255,255,255,.72)", padding: 18, display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <strong style={{ fontSize: 14 }}>Create session</strong>
                    <div className="muted small">Choose an entry object and optional initial message to create the next flow.</div>
                  </div>
                  {onCreateSession && <SessionCreator stones={stones} onCreate={onCreateSession} />}
                </div>
              </div>
            </div>
          ) : (
            <FileViewer file={file} editable={editableFile} saving={savingFile} onChange={onFileChange} onSave={onFileSave} />
          )}
        </div>
      </div>
    </main>
  );
}
