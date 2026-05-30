/**
 * FileViewer — read-only file content viewer.
 *
 * - Markdown files: rendered via MarkdownContent (toggle to raw source)
 * - Text/code files: syntax-highlighted pre block (no CodeMirror dependency)
 * - Binary files: "preview not available" notice
 * - Truncated: shows truncation badge
 *
 * ooc-3: no editable file support (knowledge CRUD deferred to Batch 4 backend).
 */

import { useState } from "react";
import type { FileContent } from "../model";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { EmptyState } from "../../../shared/ui/EmptyState";

function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function isTextFile(path: string): boolean {
  const ext = fileExt(path);
  return [
    "ts", "tsx", "js", "jsx", "mjs", "cjs",
    "json", "jsonl", "md", "txt",
    "yaml", "yml", "toml", "ini",
    "sh", "bash", "zsh",
    "css", "html", "xml",
    "lock", "gitignore", "env",
    "py", "rb", "go", "rs", "java",
    "sql", "graphql",
  ].includes(ext);
}

function isMarkdown(path: string): boolean {
  return fileExt(path) === "md";
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

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
  thread?: unknown;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
}) {
  const [renderMd, setRenderMd] = useState(true);

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

  const filePath = file.path ?? path ?? "";
  const fileName = filePath.split("/").pop() ?? filePath;
  const isMd = isMarkdown(filePath);
  const isText = isTextFile(filePath);

  return (
    <div className="file-viewer section">
      <div className="file-viewer-header" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <code className="muted small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filePath}</code>
        <span className="muted small">{formatBytes(file.size)}</span>
        {(file as { truncated?: boolean }).truncated && (
          <span className="pill" style={{ fontSize: 10 }}>truncated</span>
        )}
        {isMd && (
          <button
            className={`btn btn-sm${renderMd ? " primary" : ""}`}
            onClick={() => setRenderMd((p) => !p)}
            title={renderMd ? "View source" : "View rendered"}
          >
            {renderMd ? "Rendered" : "Source"}
          </button>
        )}
      </div>
      <div className="file-viewer-body">
        {isMd && renderMd ? (
          <div className="markdown-content">
            <MarkdownContent content={file.content} />
          </div>
        ) : isText ? (
          <pre style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 12,
            lineHeight: 1.58,
            background: "rgba(246,247,244,.95)",
            border: "1px solid rgba(224,227,220,.92)",
            borderRadius: 10,
            padding: "10px 12px",
            overflowX: "auto",
          }}>
            <code>{file.content}</code>
          </pre>
        ) : (
          <div className="empty muted">
            Binary file <strong>{fileName}</strong> — preview not available.
          </div>
        )}
      </div>
    </div>
  );
}
