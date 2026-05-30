/**
 * FileViewer — (Batch 4 placeholder)
 * Full FileViewer with CodeMirror editing will be implemented in Batch 4.
 */
import type { FileContent } from "../model";
import type { ThreadContext } from "../../chat/model";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { EmptyState } from "../../../shared/ui/EmptyState";

export function FileViewer({
  file,
  path,
  error,
}: {
  file?: FileContent;
  path?: string;
  error?: string;
  editable?: boolean;
  saving?: boolean;
  onChange?: (content: string) => void;
  onSave?: () => void;
  thread?: ThreadContext;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
}) {
  if (error && !file) {
    return <div className="section compact"><div className="error">{error}</div></div>;
  }
  if (!file) {
    return (
      <EmptyState
        title="Select a file"
        detail={path ? `Loading ${path}…` : "Pick a file from the tree on the left."}
      />
    );
  }
  return (
    <div className="file-viewer section">
      <div className="file-viewer-header">
        <code className="muted small">{file.path}</code>
        <span className="muted small">{file.size} bytes</span>
      </div>
      <div className="file-viewer-body">
        <MarkdownContent content={file.content} />
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>(Batch 4: full editor / CodeMirror coming)</p>
    </div>
  );
}
