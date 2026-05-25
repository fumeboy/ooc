import { useMemo } from "react";
import type { FileContent } from "../model";
import { formatFileContent } from "../formatter";
import { EmptyState } from "../../../shared/ui/EmptyState";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { LLMInputJsonViewer, isLlmInputJsonPath } from "./LLMInputJsonViewer";
import { ContextSnapshotViewer } from "./ContextSnapshotViewer";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { JsonTreeView } from "./JsonTreeView";
import { CsvTableView } from "./CsvTableView";
import { ImagePreview, isImagePath } from "./ImagePreview";
import type { ThreadContext } from "../../chat";
import type { ContextSnapshot } from "../context-snapshot";

function extensionsFor(path: string) {
  if (path.endsWith(".md") || path.endsWith(".markdown")) return [markdown()];
  if (path.endsWith(".json")) return [json()];
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) return [javascript({ typescript: path.endsWith(".ts") || path.endsWith(".tsx"), jsx: path.endsWith("x") })];
  return [];
}

/** 把前端 chat ThreadContext 适配为 ContextSnapshotViewer 期望的 ContextSnapshot。 */
function threadToSnapshot(thread: ThreadContext): ContextSnapshot {
  return {
    id: thread.id,
    status: thread.status,
    contextWindows: (thread.contextWindows ?? []) as ContextSnapshot["contextWindows"],
    inbox: thread.inbox,
    outbox: thread.outbox,
    events: thread.events,
  };
}

/**
 * FileViewer：文件优先；无文件且有 thread 时展示 thread 的 context；都没有则空状态。
 *
 * thread 来自 chat 域（与右侧 ChatPanel 同源），仅用于"已选 session 但未选文件"时
 * 把中间区域用作 thread context 的可视化展示，方便快速看 contextWindows / inbox / outbox。
 *
 * 当 selfObjectId / onUserReply 同时给出时，ContextSnapshotViewer 里的 talk window 详情
 * 会在 user 端（caller 或 callee 是 user）渲染一个内联 composer，让人直接以 user 身份回复。
 */
export function FileViewer({
  file,
  editable = false,
  saving = false,
  onChange,
  onSave,
  thread,
  selfObjectId,
  onUserReply,
}: {
  file?: FileContent;
  editable?: boolean;
  saving?: boolean;
  onChange?: (content: string) => void;
  onSave?: () => void;
  thread?: ThreadContext;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
}) {
  // 必须 hooks 在条件分支前。snapshot 只随 thread ref 变化而变化；ref 稳定时
  // ContextSnapshotViewer 内部的 useMemo / useEffect 不会被重置 → 选中态/展开态保留。
  const snapshot = useMemo(() => (thread ? threadToSnapshot(thread) : undefined), [thread]);
  if (!file) {
    if (snapshot) {
      return <ContextSnapshotViewer snapshot={snapshot} selfObjectId={selfObjectId} onUserReply={onUserReply} />;
    }
    return <EmptyState title="Select a file" detail="Choose a file from the tree to preview its text content." />;
  }
  if (!editable && isLlmInputJsonPath(file.path)) {
    return <LLMInputJsonViewer file={file} />;
  }
  // 只读模式下按扩展名 dispatch 专用 viewer。editable 模式（knowledge 写入）仍用 CodeMirror。
  if (!editable) {
    const lower = file.path.toLowerCase();
    if (/\.(md|markdown)$/.test(lower)) {
      return (
        <div className="file-viewer">
          <div className="file-viewer-rendered">
            <MarkdownContent content={file.content} />
          </div>
          <div className="file-viewer-footer">
            <span className="pill">{file.size}B</span>
            <span className="pill">markdown</span>
          </div>
        </div>
      );
    }
    if (lower.endsWith(".json")) {
      try {
        const parsed = JSON.parse(file.content);
        return (
          <div className="file-viewer">
            <div className="file-viewer-rendered">
              <JsonTreeView value={parsed} rootLabel={file.path.split("/").slice(-1)[0] ?? "root"} />
            </div>
            <div className="file-viewer-footer">
              <span className="pill">{file.size}B</span>
              <span className="pill">json tree</span>
            </div>
          </div>
        );
      } catch {
        // fall through to CodeMirror
      }
    }
    if (/\.(csv|tsv)$/.test(lower)) {
      const delimiter = lower.endsWith(".tsv") ? "\t" : ",";
      return (
        <div className="file-viewer">
          <div className="file-viewer-rendered">
            <CsvTableView content={file.content} delimiter={delimiter} />
          </div>
          <div className="file-viewer-footer">
            <span className="pill">{file.size}B</span>
            <span className="pill">{lower.endsWith(".tsv") ? "tsv" : "csv"}</span>
          </div>
        </div>
      );
    }
    if (isImagePath(lower)) {
      return (
        <div className="file-viewer">
          <ImagePreview path={file.path} />
        </div>
      );
    }
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
