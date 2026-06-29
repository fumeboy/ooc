/**
 * FileEditDiffView —— 把 file_window.edit 的 { old, new } 渲染为 unified diff。
 *
 * - 单条 edit:渲染一份 diff
 * - 多条 edits(MultiEdit 风格):每条独立渲染,标号
 *
 * 实现:CodeMirror 6 + @codemirror/merge 的 unifiedMergeView,显示 old(被删) →
 * new(新增)的红绿 chunk。不开启编辑、不显示 accept/reject 按钮。
 */
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { unifiedMergeView } from "@codemirror/merge";

export type EditPair = { old: string; new: string };

/** 把任意 args 安全归一化为 EditPair[];无法识别返回 null。 */
export function parseEditArgs(args: unknown): EditPair[] | null {
  if (!args || typeof args !== "object") return null;
  const obj = args as Record<string, unknown>;
  if (typeof obj.old === "string" && typeof obj.new === "string") {
    return [{ old: obj.old, new: obj.new }];
  }
  if (Array.isArray(obj.edits)) {
    const out: EditPair[] = [];
    for (const item of obj.edits) {
      if (!item || typeof item !== "object") return null;
      const rec = item as Record<string, unknown>;
      if (typeof rec.old !== "string" || typeof rec.new !== "string") return null;
      out.push({ old: rec.old, new: rec.new });
    }
    return out.length > 0 ? out : null;
  }
  return null;
}

/** 单个 EditPair 的只读 unified diff 视图。 */
function SingleDiff({ pair }: { pair: EditPair }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: pair.new,
        extensions: [
          lineNumbers(),
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          EditorView.theme({
            "&": { fontSize: "12px" },
            ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
          }),
          unifiedMergeView({
            original: pair.old,
            mergeControls: false,
            highlightChanges: true,
            gutter: true,
          }),
        ],
      }),
      parent: ref.current,
    });
    return () => view.destroy();
  }, [pair.old, pair.new]);
  return <div ref={ref} className="llm-input-diff" />;
}

export function FileEditDiffView({ pairs }: { pairs: EditPair[] }) {
  if (pairs.length === 1) {
    return <SingleDiff pair={pairs[0]!} />;
  }
  return (
    <div className="llm-input-diff-list">
      {pairs.map((p, idx) => (
        <div key={idx} className="llm-input-diff-item">
          <div className="llm-input-diff-head">edit #{idx + 1}</div>
          <SingleDiff pair={p} />
        </div>
      ))}
    </div>
  );
}
