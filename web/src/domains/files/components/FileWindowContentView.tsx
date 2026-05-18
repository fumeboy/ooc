/**
 * FileWindowContentView —— file_window 详情面板中"按 LLM 视角预览文件内容"的子视图。
 *
 * 行为:
 * - mount 时通过 /api/file/read fetch 整文件
 * - 若 file_window 携带 lines [a,b] 或 columns [a,b],按后端 sliceByLinesColumns 同语义裁剪
 * - 在 CodeMirror 中只读展示,带行号(行号反映原文件,而非裁剪后的相对行)
 * - truncated 时在底部提示
 * - 失败 / 加载中走简短文字
 */
import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { EditorView } from "@codemirror/view";
import { fetchAnyFile } from "../query";
import type { AnyFileContent } from "../model";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";

function extensionsFor(path: string) {
  if (path.endsWith(".md") || path.endsWith(".markdown")) return [markdown()];
  if (path.endsWith(".json")) return [json()];
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) {
    return [javascript({ typescript: /\.(ts|tsx)$/.test(path), jsx: /x$/.test(path) })];
  }
  return [];
}

/** 与后端 thinkable/context/render sliceByLinesColumns 同语义:lines/columns 都是 1-based [start,end],闭区间。 */
function sliceByLinesColumns(
  source: string,
  lines?: [number, number],
  columns?: [number, number],
): { sliced: string; startLine: number } {
  let arr = source.split("\n");
  let startLine = 1;
  if (lines) {
    const [a, b] = lines;
    const lo = Math.max(1, a);
    const hi = Math.max(lo, b);
    arr = arr.slice(lo - 1, hi);
    startLine = lo;
  }
  if (columns) {
    const [a, b] = columns;
    const lo = Math.max(1, a);
    const hi = Math.max(lo, b);
    arr = arr.map((line) => line.slice(lo - 1, hi));
  }
  return { sliced: arr.join("\n"), startLine };
}

export function FileWindowContentView({
  path,
  lines,
  columns,
}: {
  path: string;
  lines?: [number, number];
  columns?: [number, number];
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; data: AnyFileContent }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchAnyFile(path)
      .then((data) => {
        if (cancelled) return;
        setState({ kind: "ok", data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (state.kind === "loading") {
    return <div className="llm-input-empty">loading {path}…</div>;
  }
  if (state.kind === "error") {
    return <div className="llm-input-empty llm-input-empty-error">读取失败:{state.message}</div>;
  }
  const { sliced, startLine } = sliceByLinesColumns(state.data.content, lines, columns);
  const isMarkdown = /\.(md|markdown)$/i.test(path);
  return (
    <div className="llm-input-file-preview">
      {isMarkdown ? (
        <div className="llm-input-md-body">
          <MarkdownContent content={sliced} />
        </div>
      ) : (
        <CodeMirror
          className="code-editor is-readonly"
          value={sliced}
          editable={false}
          extensions={[
            ...extensionsFor(path),
            EditorView.theme({ "&": { fontSize: "12px" } }),
          ]}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
          }}
        />
      )}
      <div className="llm-input-file-preview-foot">
        <span>{state.data.size}B total</span>
        {lines && <span>· lines {lines[0]}–{lines[1]} (showing from line {startLine})</span>}
        {!lines && <span>· full file</span>}
        {columns && <span>· columns {columns[0]}–{columns[1]}</span>}
        {state.data.truncated && <span className="llm-input-file-preview-trunc">· truncated</span>}
      </div>
    </div>
  );
}
