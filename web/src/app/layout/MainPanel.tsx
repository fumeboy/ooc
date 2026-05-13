import type { FileContent } from "../../domains/files";
import { FileViewer } from "../../domains/files/components/FileViewer";

export function MainPanel({ file, path, error, loading, editableFile, savingFile, onFileChange, onFileSave }: { file?: FileContent; path?: string; error?: string; loading: boolean; editableFile?: boolean; savingFile?: boolean; onFileChange?: (content: string) => void; onFileSave?: () => void }) {
  const showBlockingError = Boolean(error && file);
  return <main className="panel main-panel"><div className="breadcrumb-bar"><span>{path ? path.split("/").join(" › ") : "flows › hi › objects › supervisor › threads › root"}</span><span className="refresh">↻</span></div><div className="content-tabs"><strong>{path?.split("/").at(-1) ?? "OOC World"}</strong><span className="muted small">{file ? `${file.size} chars` : "flows / stones / files"}</span>{loading && <span className="pill">loading</span>}{editableFile && <span className="pill">codemirror</span>}{error && !file && <span className="muted small">backend offline</span>}</div><div className="main-body">{showBlockingError && <div className="section compact"><div className="error">{error}</div></div>}<FileViewer file={file} editable={editableFile} saving={savingFile} onChange={onFileChange} onSave={onFileSave} /></div></main>;
}
