/**
 * CodeMirrorViewer — 只读代码查看器（基于 CodeMirror 6）
 *
 * 支持 JSON / JavaScript / TypeScript / Markdown 语法高亮。
 * 纯查看模式，不可编辑。
 */
import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oocTheme, readonlyExtensions, getLanguageExtension } from "./codemirror/theme";

interface CodeMirrorViewerProps {
  content: string;
  ext: string;
}

export function CodeMirrorViewer({ content, ext }: CodeMirrorViewerProps) {
  const extensions = useMemo(() => {
    const exts = [oocTheme, ...readonlyExtensions];
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
