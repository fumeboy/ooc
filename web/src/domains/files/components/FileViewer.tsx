import type { FileContent } from "../model";
import { formatFileContent } from "../formatter";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";

function extensionsFor(path: string) {
  if (path.endsWith(".md") || path.endsWith(".markdown")) return [markdown()];
  if (path.endsWith(".json")) return [json()];
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) return [javascript({ typescript: path.endsWith(".ts") || path.endsWith(".tsx"), jsx: path.endsWith("x") })];
  return [];
}

export function FileViewer({ file, editable = false, saving = false, onChange, onSave }: { file?: FileContent; editable?: boolean; saving?: boolean; onChange?: (content: string) => void; onSave?: () => void }) {
  if (!file) return <EmptyState title="Select a file" detail="Choose a file from the tree to preview its text content." />;
  const formatted = formatFileContent(file.path, file.content);
  return (
    <div className="file-viewer">
      <div className="row space-between" style={{ marginBottom: 12 }}>
        <strong>{file.path}</strong>
        <div className="row">
          <span className="pill">{file.size}B</span>
          {editable && <button className="btn" disabled={saving} onClick={onSave}>{saving ? "Saving..." : "Save"}</button>}
        </div>
      </div>
      {editable ? <CodeMirror className="code-editor" value={file.content} extensions={extensionsFor(file.path)} basicSetup={{ lineNumbers: true, foldGutter: true }} onChange={(value) => onChange?.(value)} /> : formatted.kind === "markdown" ? <MarkdownContent content={formatted.content} /> : <pre className={formatted.kind === "json" ? "json-block" : ""}>{formatted.content}</pre>}
    </div>
  );
}
