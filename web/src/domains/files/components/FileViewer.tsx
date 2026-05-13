import type { FileContent } from "../model";
import { formatFileContent } from "../formatter";
import { EmptyState } from "../../../shared/ui/EmptyState";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { LLMInputJsonViewer, isLlmInputJsonPath } from "./LLMInputJsonViewer";

function extensionsFor(path: string) {
  if (path.endsWith(".md") || path.endsWith(".markdown")) return [markdown()];
  if (path.endsWith(".json")) return [json()];
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) return [javascript({ typescript: path.endsWith(".ts") || path.endsWith(".tsx"), jsx: path.endsWith("x") })];
  return [];
}

export function FileViewer({ file, editable = false, saving = false, onChange, onSave }: { file?: FileContent; editable?: boolean; saving?: boolean; onChange?: (content: string) => void; onSave?: () => void }) {
  if (!file) return <EmptyState title="Select a file" detail="Choose a file from the tree to preview its text content." />;
  if (!editable && isLlmInputJsonPath(file.path)) {
    return <LLMInputJsonViewer file={file} />;
  }
  const formatted = formatFileContent(file.path, file.content);
  return (
    <div className="file-viewer">
      <CodeMirror
        className={`code-editor ${editable ? "is-editable" : "is-readonly"}`}
        value={formatted.content}
        editable={editable}
        extensions={extensionsFor(file.path)}
        basicSetup={{ lineNumbers: true, foldGutter: true }}
        onChange={(value) => onChange?.(value)}
      />
      <div className="file-viewer-footer">
        <span className="pill">{file.size}B</span>
        {editable && <button className="btn" disabled={saving} onClick={onSave}>{saving ? "Saving..." : "Save"}</button>}
      </div>
    </div>
  );
}
