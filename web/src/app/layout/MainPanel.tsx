import type { ReactNode } from "react";
import type { FileContent } from "../../domains/files";
import { FileViewer } from "../../domains/files/components/FileViewer";
import type { Stone } from "../../domains/stones";
import type { ThreadContext } from "../../domains/chat";
import { Welcome } from "./Welcome";
import {
  ClientWithSourceToggle,
  matchClientTarget,
} from "../../domains/clients/ClientWithSourceToggle";

export function MainPanel({
  isWelcome = false,
  stones = [],
  onCreateSession,
  file,
  path,
  error,
  loading,
  editableFile,
  savingFile,
  onFileChange,
  onFileSave,
  thread,
  selfObjectId,
  onUserReply,
  onRefresh,
  threadHeader,
}: {
  isWelcome?: boolean;
  stones?: Stone[];
  onCreateSession?: (input: { sessionId: string; targetObjectId: string; initialMessage: string }) => Promise<void>;
  file?: FileContent;
  path?: string;
  error?: string;
  loading: boolean;
  editableFile?: boolean;
  savingFile?: boolean;
  onFileChange?: (content: string) => void;
  onFileSave?: () => void;
  thread?: ThreadContext;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
  onRefresh?: () => void | Promise<void>;
  threadHeader?: ReactNode;
}) {
  const showBlockingError = Boolean(error && file);
  // 命中 plan-003 §3.1 时优先走 ClientWithSourceToggle；不命中走原 FileViewer 分支
  const clientTarget = path ? matchClientTarget(path) : undefined;
  return (
    <main className="main-panel gap-1">
      <div className="breadcrumb-bar panel">
        <span>{isWelcome ? "flows › welcome" : path ? path.split("/").join(" › ") : "flows › hi › objects › supervisor › threads › root"}</span>
        <div className="flex items-center gap-3">
          <strong>{isWelcome ? "Welcome" : path?.split("/").at(-1) ?? "OOC World"}</strong>
          {loading && <span className="pill">loading</span>}
          {!isWelcome && editableFile && !clientTarget && <span className="pill">codemirror</span>}
          {clientTarget && <span className="pill">object client</span>}
          {error && !file && !isWelcome && <span className="muted small">backend offline</span>}
          {threadHeader}
          <button type="button" className="refresh" onClick={onRefresh} disabled={loading || !onRefresh} aria-label="Refresh" title="Refresh">↻</button>
        </div>
      </div>
      <div className="panel flex flex-col flex-grow">
        <div className="main-body">
          {showBlockingError && <div className="section compact"><div className="error">{error}</div></div>}
          {isWelcome ? (
            <Welcome stones={stones} onCreateSession={onCreateSession} />
          ) : clientTarget && path ? (
            <ClientWithSourceToggle target={clientTarget} sourcePath={path} />
          ) : (
            <FileViewer file={file} editable={editableFile} saving={savingFile} onChange={onFileChange} onSave={onFileSave} thread={thread} selfObjectId={selfObjectId} onUserReply={onUserReply} />
          )}
        </div>
      </div>
    </main>
  );
}
