/**
 * CodeMirrorViewer — 只读代码查看器（基于 CodeMirror 6）
 *
 * 支持 JSON / JavaScript / TypeScript / Markdown 语法高亮。
 * 纯查看模式，不可编辑。
 */
import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";

/** 根据文件扩展名选择语言扩展 */
function getLanguageExtension(ext: string) {
  switch (ext) {
    case "json":
      return json();
    case "js":
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "md":
      return markdown();
    default:
      return undefined;
  }
}

/** 暖色调浅色主题（匹配 OOC 前端风格） */
const oocTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    fontSize: "13px",
  },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    border: "none",
    paddingRight: "8px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-cursor": {
    display: "none",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent) !important",
  },
});

interface CodeMirrorViewerProps {
  content: string;
  ext: string;
}

export function CodeMirrorViewer({ content, ext }: CodeMirrorViewerProps) {
  const extensions = useMemo(() => {
    const exts = [oocTheme, EditorView.lineWrapping];
    const lang = getLanguageExtension(ext);
    if (lang) exts.push(lang);
    return exts;
  }, [ext]);

  return (
    <CodeMirror
      value={content}
      extensions={extensions}
      editable={false}
      readOnly={true}
      basicSetup={{
        lineNumbers: true,
        foldGutter: ext === "json",
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
    />
  );
}
