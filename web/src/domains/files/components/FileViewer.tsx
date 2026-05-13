import type { FileContent } from "../model";
import { formatFileContent } from "../formatter";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";

export function FileViewer({ file }: { file?: FileContent }) {
  if (!file) return <EmptyState title="Select a file" detail="Choose a file from the tree to preview its text content." />;
  const formatted = formatFileContent(file.path, file.content);
  return (
    <div className="file-viewer">
      <div className="row space-between" style={{ marginBottom: 12 }}>
        <strong>{file.path}</strong>
        <span className="pill">{file.size}B</span>
      </div>
      {formatted.kind === "markdown" ? <MarkdownContent content={formatted.content} /> : <pre className={formatted.kind === "json" ? "json-block" : ""}>{formatted.content}</pre>}
    </div>
  );
}

