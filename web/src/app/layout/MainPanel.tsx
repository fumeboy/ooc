import type { FileContent } from "../../domains/files";
import { FileViewer } from "../../domains/files/components/FileViewer";
import type { Stone } from "../../domains/stones";
import { Welcome } from "./Welcome";

export function MainPanel({ isWelcome = false, stones = [], onCreateSession, file, path, error, loading, editableFile, savingFile, onFileChange, onFileSave }: { isWelcome?: boolean; stones?: Stone[]; onCreateSession?: (input: { sessionId: string; objectId: string; initialMessage?: string }) => Promise<void>; file?: FileContent; path?: string; error?: string; loading: boolean; editableFile?: boolean; savingFile?: boolean; onFileChange?: (content: string) => void; onFileSave?: () => void }) {
  const showBlockingError = Boolean(error && file);
  return (
    <main className="main-panel gap-1">
      <div className="breadcrumb-bar panel">
        <span>{isWelcome ? "flows › welcome" : path ? path.split("/").join(" › ") : "flows › hi › objects › supervisor › threads › root"}</span>
        <div className="flex items-center gap-3">
          <strong>{isWelcome ? "Welcome" : path?.split("/").at(-1) ?? "OOC World"}</strong>
          {loading && <span className="pill">loading</span>}
          {!isWelcome && editableFile && <span className="pill">codemirror</span>}
          {error && !file && !isWelcome && <span className="muted small">backend offline</span>}
          <span className="refresh">↻</span>
        </div>
      </div>
      <div className="panel flex flex-col flex-grow">
        <div className="main-body">
          {showBlockingError && <div className="section compact"><div className="error">{error}</div></div>}
          {isWelcome ? (
            <Welcome stones={stones} onCreateSession={onCreateSession} />
          ) : (
            <FileViewer file={file} editable={editableFile} saving={savingFile} onChange={onFileChange} onSave={onFileSave} />
          )}
        </div>
      </div>
    </main>
  );
}
