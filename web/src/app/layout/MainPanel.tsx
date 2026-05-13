import type { FileContent } from "../../domains/files";
import { FileViewer } from "../../domains/files/components/FileViewer";

export function MainPanel({ file, path, error, loading }: { file?: FileContent; path?: string; error?: string; loading: boolean }) {
  return <main className="panel main-panel"><div className="header"><div><div className="header-title">{path ?? "OOC World"}</div><div className="muted small">flows / stones / files</div></div>{loading && <span className="pill">loading</span>}</div><div className="main-body">{error && <div className="section"><div className="error">{error}</div></div>}<FileViewer file={file} /></div></main>;
}

