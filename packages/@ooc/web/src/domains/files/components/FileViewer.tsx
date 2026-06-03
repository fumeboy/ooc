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
import {
  isClientEntryPath,
  matchClientTarget,
} from "../../clients/client-path";
import { ClientWithSourceToggle } from "../../clients/ClientWithSourceToggle";

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
  path,
  error,
  editable = false,
  saving = false,
  onChange,
  onSave,
  thread,
  selfObjectId,
  onUserReply,
  _allowClientPreview = true,
}: {
  file?: FileContent;
  /**
   * H-2 (Round 5): 用户进入 `/files/<path>` 时即使 backend 404, 也应该把"用户原本
   * 要看哪个 path"+ "为什么没看到" 透传出来; 否则只显示通用 "Select a file" 占位
   * 让用户误以为 URL 路径参数没起作用 (实际是文件不存在 / 不在 world 内)。
   */
  path?: string;
  error?: string;
  editable?: boolean;
  saving?: boolean;
  onChange?: (content: string) => void;
  onSave?: () => void;
  thread?: ThreadContext;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
  /** Internal: false when called from ClientWithSourceToggle to prevent recursive preview. */
  _allowClientPreview?: boolean;
}) {
  // 必须 hooks 在条件分支前。snapshot 只随 thread ref 变化而变化；ref 稳定时
  // ContextSnapshotViewer 内部的 useMemo / useEffect 不会被重置 → 选中态/展开态保留。
  const snapshot = useMemo(() => (thread ? threadToSnapshot(thread) : undefined), [thread]);
  if (!file) {
    // H-2: URL 路径明确指定了文件 (`/files/<path>`) 但 fetch 失败 → 不是"没选文件",
    // 是"文件不存在 / 不在 world 内"。优先呈现错误,避免与"未选文件"的占位混淆。
    if (path && error) {
      return (
        <EmptyState
          title="File not available"
          detail={`无法预览 ${path} — ${error}. 该路径可能不在 OOC world 内, 或拼写有误. 用左侧 tree 浏览 world 文件; meta/ 等仓库源代码不在 world 内、当前不支持预览.`}
        />
      );
    }
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
    // Object visible entry (stones/*/visible/index.tsx or legacy client/index.tsx) —
    // render the actual React component with a 已渲染/源码 toggle, exactly like
    // /stones/<id> shortcut does. This is what makes [[ui file-link]] → visible
    // preview work end-to-end.
    // Guard: skip when called from inside ClientWithSourceToggle itself (the
    // source pane's FileViewer) to avoid recursion.
    if (_allowClientPreview && isClientEntryPath(file.path)) {
      const target = matchClientTarget(file.path);
      if (target) {
        return <ClientWithSourceToggle target={target} sourcePath={file.path} />;
      }
    }
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
