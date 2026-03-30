/**
 * 共享的 CodeMirror 主题配置和工具函数
 *
 * 被 CodeMirrorViewer 和 FileDiffViewer 共用。
 * 使用 CSS Variables 自动适配亮暗主题。
 */

import { EditorView } from "@codemirror/view";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";

/** 暖色调浅色主题（匹配 OOC 前端风格） */
export const oocTheme = EditorView.theme({
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

/** 只读模式共享的扩展 */
export const readonlyExtensions = [
  EditorView.lineWrapping,
];

/** 根据文件扩展名选择语言扩展 */
export function getLanguageExtension(ext: string) {
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
