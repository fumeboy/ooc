/**
 * file/visible/diff.tsx — file_window 类型的 visible/diff 组件（线 C exemplar）。
 *
 * 对称 visible/index.tsx 的 Window 组件；签名收敛到 WindowDiffProps ({previous, current})。
 * 逻辑来自 packages/@ooc/web/src/domains/sessions/components/window-diff-renderers/FileWindowDiff.tsx，
 * 删去 windowType / windowId 引用（type 由解析层定，id 不参与渲染）。
 *
 * 数据源策略（软退化优先）：
 *   1. 优先：current.fileDiff = { previousContent, currentContent, path, isBinary?, tooLarge? }
 *   2. fallback：previous / current 的 content 字段
 *   3. 软退化：均无 → 显示 "file diff payload not yet available"，不崩
 */

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { unifiedMergeView } from "@codemirror/merge";
import type { FileDiffData, WindowSnapshotEntry } from "@ooc/web/src/domains/sessions/components/window-diff.helpers";
import type { WindowDiffProps } from "@ooc/web/src/domains/sessions/components/window-diff/window-diff-props";

/** 安全提取 fileDiff 字段；previous/current 可能任意 shape。 */
function extractFileDiff(value: unknown): FileDiffData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const fd = (value as Partial<WindowSnapshotEntry>).fileDiff;
  if (!fd) return undefined;
  if (
    typeof fd.previousContent === "string" &&
    typeof fd.currentContent === "string" &&
    typeof fd.path === "string"
  ) {
    return fd;
  }
  return undefined;
}

/** 后备：从 file_window 对象上挖 content / path。 */
function extractWindowContent(value: unknown): { content?: string; path?: string } {
  if (!value || typeof value !== "object") return {};
  const obj = value as Record<string, unknown>;
  const content = typeof obj.content === "string" ? obj.content : undefined;
  const path = typeof obj.path === "string" ? obj.path : undefined;
  return { content, path };
}

function PathHint({ path }: { path?: string }) {
  if (!path) return null;
  return (
    <div className="muted small" style={{ marginTop: 4 }}>
      path: <code>{path}</code>
    </div>
  );
}

function Notice({
  variant,
  children,
  path,
}: {
  variant: "info" | "warn";
  children: React.ReactNode;
  path?: string;
}) {
  const bg =
    variant === "warn"
      ? "rgba(253, 233, 214, .55)"
      : "rgba(232, 240, 254, .35)";
  return (
    <div
      className="window-diff-file-notice"
      style={{
        padding: "8px 10px",
        border: "1px dashed var(--border)",
        borderRadius: 6,
        background: bg,
        fontSize: 12,
      }}
    >
      {children}
      <PathHint path={path} />
    </div>
  );
}

export default function FileWindowDiff({ previous, current }: WindowDiffProps) {
  // ----- 数据获取（优先 fileDiff，再 fallback content 提取） -----
  const currentFileDiff = extractFileDiff(current);
  const previousFileDiff = extractFileDiff(previous);
  // current 优先（changed/added 都看当前 entry）；removed 时回退到 previous
  const fileDiff = currentFileDiff ?? previousFileDiff;

  // current undefined → removed；previous undefined → added
  const isAdded = previous === undefined && current !== undefined;
  const isRemoved = current === undefined && previous !== undefined;

  // ----- 退化分支 -----
  if (fileDiff && fileDiff.isBinary) {
    return (
      <div data-testid="file-window-diff">
        <Notice variant="warn" path={fileDiff.path}>
          binary file — diff not shown.
        </Notice>
      </div>
    );
  }
  if (fileDiff && fileDiff.tooLarge) {
    return (
      <div data-testid="file-window-diff">
        <Notice variant="warn" path={fileDiff.path}>
          file too large to diff inline.
        </Notice>
      </div>
    );
  }

  // 没 fileDiff（F2 未到位） → 试 content fallback
  if (!fileDiff) {
    const prevW = extractWindowContent(previous);
    const curW = extractWindowContent(current);
    const prevContent = prevW.content;
    const curContent = curW.content;
    const path = curW.path ?? prevW.path;

    if (typeof prevContent !== "string" && typeof curContent !== "string") {
      return (
        <div data-testid="file-window-diff">
          <Notice variant="info" path={path}>
            file diff payload not yet available (backend windowsSnapshot doesn&apos;t
            carry <code>fileDiff</code> yet; <code>content</code> not in
            snapshot).
          </Notice>
        </div>
      );
    }
    // 拿到 content fallback —— 用伪 fileDiff 跑 unified 渲染
    const synthetic: FileDiffData = {
      previousContent: prevContent ?? "",
      currentContent: curContent ?? "",
      path: path ?? "(unknown path)",
    };
    return (
      <div
        data-testid="file-window-diff"
        data-added={isAdded || undefined}
        data-removed={isRemoved || undefined}
        data-synthetic="true"
      >
        <div className="muted small" style={{ marginBottom: 4, fontSize: 11 }}>
          (fallback content — backend fileDiff payload not yet available)
        </div>
        <FileMergeView
          diff={synthetic}
          isAdded={isAdded}
          isRemoved={isRemoved}
          synthetic
        />
      </div>
    );
  }

  // ----- 主路径：fileDiff present -----
  return (
    <div
      data-testid="file-window-diff"
      data-added={isAdded || undefined}
      data-removed={isRemoved || undefined}
    >
      <FileMergeView
        diff={fileDiff}
        isAdded={isAdded}
        isRemoved={isRemoved}
      />
    </div>
  );
}

interface FileMergeViewProps {
  diff: FileDiffData;
  isAdded: boolean;
  isRemoved: boolean;
  /** 标记此次渲染来自 content fallback 而非真正的 fileDiff payload。 */
  synthetic?: boolean;
}

function FileMergeView({
  diff,
  isAdded,
  isRemoved,
  synthetic,
}: FileMergeViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    // 销毁旧 view（prev/current 变化时）
    viewRef.current?.destroy();
    viewRef.current = null;

    const state = EditorState.create({
      doc: diff.currentContent,
      extensions: [
        lineNumbers(),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        unifiedMergeView({
          original: diff.previousContent,
          mergeControls: false,
          highlightChanges: true,
          gutter: true,
          syntaxHighlightDeletions: false,
          allowInlineDiffs: true,
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [diff.previousContent, diff.currentContent]);

  return (
    <div
      className="window-diff-file"
      data-added={isAdded || undefined}
      data-removed={isRemoved || undefined}
    >
      <div
        className="muted small"
        style={{ marginBottom: 4, display: "flex", gap: 8, alignItems: "center" }}
      >
        <span>
          file diff{synthetic ? " (fallback content)" : ""}: <code>{diff.path}</code>
        </span>
        {isAdded && (
          <span style={{ color: "#238d61", fontWeight: 500 }}>(added)</span>
        )}
        {isRemoved && (
          <span style={{ color: "#a35a14", fontWeight: 500 }}>(removed)</span>
        )}
      </div>
      <div
        ref={hostRef}
        className="window-diff-file-mergeview"
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          maxHeight: 480,
          overflow: "auto",
        }}
      />
    </div>
  );
}
