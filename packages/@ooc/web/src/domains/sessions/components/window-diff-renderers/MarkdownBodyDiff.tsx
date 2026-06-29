/**
 * MarkdownBodyDiff — 共享组件：用 @codemirror/merge unifiedMergeView
 * 在 markdown 语境下做 body 文本 diff。被 KnowledgeWindowDiff /
 * 复用。
 */

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { unifiedMergeView } from "@codemirror/merge";
import { markdown } from "@codemirror/lang-markdown";

export function MarkdownBodyDiff({
  previousBody,
  currentBody,
  testId,
}: {
  previousBody: string;
  currentBody: string;
  testId?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    viewRef.current?.destroy();
    viewRef.current = null;

    const state = EditorState.create({
      doc: currentBody,
      extensions: [
        lineNumbers(),
        markdown(),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        unifiedMergeView({
          original: previousBody,
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
  }, [previousBody, currentBody]);

  return (
    <div
      ref={hostRef}
      data-testid={testId}
      className="window-diff-markdown-body"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        maxHeight: 480,
        overflow: "auto",
      }}
    />
  );
}
