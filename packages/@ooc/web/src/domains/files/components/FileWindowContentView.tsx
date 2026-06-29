/**
 * FileWindowContentView —— file_window 详情面板中"按 LLM 视角预览文件内容"的子视图。
 *
 * 按扩展名 dispatch 专用 viewer。先 fetch 内容，再交给：
 *   - `.md` / `.markdown` → MarkdownContent
 *   - `.json` → JsonTreeView（解析失败回退 CodeMirror）
 *   - `.csv` / `.tsv` → CsvTableView
 *   - `.png` / `.jpg` / `.gif` / `.svg` / `.webp` 等 → ImagePreview
 *   - 其它 → CodeMirror with syntax highlighting
 *
 * 行为不变的部分：
 * - mount 时通过 `/api/file/read` fetch 整文件
 * - 若 file_window 携带 lines [a,b] 或 columns [a,b]，按后端 sliceByLinesColumns 同语义裁剪
 * - truncated 时在底部提示
 * - 失败 / 加载中走简短文字
 *
 * lines / columns 裁剪只对"文本类"viewer（md / csv / 其它 CodeMirror）应用；
 * JSON tree 与图片整体渲染，不裁剪（否则解析必然失败/图片无意义）。
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
import { JsonTreeView } from "./JsonTreeView";
import { CsvTableView } from "./CsvTableView";
import { ImagePreview, isImagePath } from "./ImagePreview";

function extensionsFor(path: string) {
  if (path.endsWith(".md") || path.endsWith(".markdown")) return [markdown()];
  if (path.endsWith(".json")) return [json()];
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) {
    return [javascript({ typescript: /\.(ts|tsx)$/.test(path), jsx: /x$/.test(path) })];
  }
  return [];
}

/** 与后端 thinkable/context/render sliceByLinesColumns 同语义：lines/columns 都是 1-based [start,end]，闭区间。 */
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

type ViewerKind = "markdown" | "json" | "csv" | "image" | "code";

function viewerKindForPath(path: string): ViewerKind {
  const lower = path.toLowerCase();
  if (/\.(md|markdown)$/.test(lower)) return "markdown";
  if (lower.endsWith(".json")) return "json";
  if (/\.(csv|tsv)$/.test(lower)) return "csv";
  if (isImagePath(lower)) return "image";
  return "code";
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

  const viewerKind = viewerKindForPath(path);
  // image 走 ImagePreview 自己内部 fetch；其它 viewer 都需要纯文本，这里统一拉。
  const skipOwnFetch = viewerKind === "image";

  useEffect(() => {
    if (skipOwnFetch) {
      setState({ kind: "loading" });
      return;
    }
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
  }, [path, skipOwnFetch]);

  if (viewerKind === "image") {
    return <ImagePreview path={path} />;
  }

  if (state.kind === "loading") {
    return <div className="llm-input-empty">loading {path}…</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="llm-input-empty llm-input-empty-error">读取失败：{state.message}</div>
    );
  }
  const { sliced, startLine } = sliceByLinesColumns(state.data.content, lines, columns);

  const body = (() => {
    if (viewerKind === "markdown") {
      return (
        <div className="llm-input-md-body">
          <MarkdownContent content={sliced} />
        </div>
      );
    }
    if (viewerKind === "json") {
      try {
        const parsed = JSON.parse(sliced);
        return <JsonTreeView value={parsed} rootLabel={path.split("/").slice(-1)[0] ?? "root"} />;
      } catch {
        // 解析失败：可能是被裁切到一半。回退到原样 CodeMirror，附一个 hint。
        return (
          <>
            <div className="muted small" style={{ padding: "4px 8px" }}>
              JSON 解析失败（可能被 lines/columns 裁切）；回退源码视图。
            </div>
            <CodeMirror
              className="code-editor is-readonly"
              value={sliced}
              editable={false}
              extensions={[json(), EditorView.theme({ "&": { fontSize: "12px" } })]}
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          </>
        );
      }
    }
    if (viewerKind === "csv") {
      const delimiter = path.toLowerCase().endsWith(".tsv") ? "\t" : ",";
      return <CsvTableView content={sliced} delimiter={delimiter} />;
    }
    // code (默认)
    return (
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
    );
  })();

  return (
    <div className="llm-input-file-preview">
      {body}
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
