/**
 * FileDiffViewer — 文件 Diff 对比组件
 *
 * 基于 @codemirror/merge 实现，支持分栏和统一两种视图模式。
 * 用于 CodeAgent 展示代码变更前后对比。
 *
 * @ref https://github.com/codemirror/merge
 */

import React, { useEffect, useRef, useMemo } from "react";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — @codemirror/merge 未提供类型声明（运行时模块存在），跳过 TS 检查
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import CodeMirror from "@uiw/react-codemirror";
import { oocTheme, readonlyExtensions, getLanguageExtension } from "./codemirror/theme";

export type FileDiffViewMode = "split" | "unified";

// Diff 高亮颜色主题
const diffHighlight = EditorView.theme({
  ".cm-deletedLine": {
    backgroundColor: "color-mix(in srgb, #fecaca 30%, transparent)",
  },
  ".cm-deletedText": {
    backgroundColor: "#fca5a5",
    textDecoration: "line-through",
  },
  ".cm-insertedLine": {
    backgroundColor: "color-mix(in srgb, #bbf7d0 30%, transparent)",
  },
  ".cm-insertedText": {
    backgroundColor: "#86efac",
  },
  // Gutter 标记
  ".cm-changeGutter": {
    width: "4px",
    padding: "0 2px",
  },
  ".cm-changeGutter.insert": {
    borderLeft: "3px solid #22c55e",
  },
  ".cm-changeGutter.delete": {
    borderLeft: "3px solid #ef4444",
  },
  // MergeView 容器样式
  ".cm-mergeView": {
    display: "flex",
  },
  ".cm-mergeViewEditor": {
    flex: 1,
    overflow: "hidden",
  },
  ".cm-panels": {
    display: "none",
  },
});

interface FileDiffViewerProps {
  /** 旧版本内容 */
  oldContent: string;
  /** 新版本内容 */
  newContent: string;
  /** 文件扩展名，用于语法高亮 */
  language?: string;
  /** 视图模式：分栏(split)或统一(unified)视图 */
  viewMode?: FileDiffViewMode;
  /** 文件名（可选，用于标题展示） */
  fileName?: string;
  /** 是否显示行号 */
  showGutter?: boolean;
  /** 是否允许折叠未修改的代码块 */
  collapseUnchanged?: boolean;
  /** 最大高度 */
  maxHeight?: string;
}

export type { FileDiffViewerProps };

/**
 * 构建扩展数组
 */
function buildExtensions(language: string | undefined, ...additional: any[]) {
  const exts: any[] = [oocTheme, diffHighlight, ...readonlyExtensions];

  if (language) {
    const langExt = getLanguageExtension(language);
    if (langExt) exts.push(langExt);
  }

  exts.push(...additional);
  return exts;
}

/**
 * SplitDiffViewer — 分栏视图 Diff 组件
 *
 * 使用 MergeView 类创建并排的两个编辑器。
 */
function SplitDiffViewerImpl({
  oldContent,
  newContent,
  language,
  showGutter = true,
  collapseUnchanged = false,
  maxHeight,
}: Omit<FileDiffViewerProps, "viewMode" | "fileName">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);

  // 构建扩展
  const extensions = useMemo(
    () => buildExtensions(language),
    [language]
  );

  // 构建 collapseUnchanged 配置
  const collapseConfig = collapseUnchanged
    ? { margin: 2, minSize: 4 }
    : undefined;

  useEffect(() => {
    if (!containerRef.current) return;

    // 销毁已有的实例
    if (mergeViewRef.current) {
      mergeViewRef.current.destroy();
      mergeViewRef.current = null;
    }

    // 创建新的 MergeView 实例
    mergeViewRef.current = new MergeView({
      a: {
        doc: oldContent,
        extensions,
      },
      b: {
        doc: newContent,
        extensions,
      },
      parent: containerRef.current,
      highlightChanges: true,
      gutter: showGutter,
      collapseUnchanged: collapseConfig,
      orientation: "a-b",
    });

    return () => {
      if (mergeViewRef.current) {
        mergeViewRef.current.destroy();
        mergeViewRef.current = null;
      }
    };
  }, [oldContent, newContent, extensions, showGutter, collapseConfig]);

  const containerStyle: React.CSSProperties = {
    maxHeight,
    overflow: "auto",
  };

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      className="file-diff-viewer-split"
    />
  );
}

/**
 * UnifiedDiffViewer — 统一视图 Diff 组件
 *
 * 使用 unifiedMergeView extension 创建单编辑器统一视图。
 */
function UnifiedDiffViewerImpl({
  oldContent,
  newContent,
  language,
  showGutter = true,
  collapseUnchanged = false,
  maxHeight,
}: Omit<FileDiffViewerProps, "viewMode" | "fileName">) {
  const collapseConfig = collapseUnchanged
    ? { margin: 2, minSize: 4 }
    : undefined;

  const extensions = useMemo(() => {
    return buildExtensions(
      language,
      unifiedMergeView({
        original: oldContent,
        highlightChanges: true,
        gutter: showGutter,
        mergeControls: false,
        syntaxHighlightDeletions: true,
        collapseUnchanged: collapseConfig,
      })
    );
  }, [oldContent, language, showGutter, collapseConfig]);

  const containerStyle: React.CSSProperties = {
    maxHeight,
    overflow: "auto",
  };

  return (
    <div style={containerStyle} className="file-diff-viewer-unified">
      <CodeMirror
        value={newContent}
        extensions={extensions}
        editable={false}
        readOnly={true}
        basicSetup={{
          lineNumbers: showGutter,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
      />
    </div>
  );
}

/**
 * FileDiffViewer — 文件 Diff 对比组件
 *
 * 支持分栏(split)和统一(unified)两种视图模式。
 */
export function FileDiffViewer({
  oldContent,
  newContent,
  language,
  viewMode = "split",
  fileName,
  showGutter = true,
  collapseUnchanged = false,
  maxHeight,
}: FileDiffViewerProps) {
  return (
    <div className="file-diff-viewer">
      {fileName && (
        <div className="text-xs text-[var(--muted-foreground)] mb-2 px-2 font-mono">
          {fileName}
        </div>
      )}
      {viewMode === "split" ? (
        <SplitDiffViewerImpl
          oldContent={oldContent}
          newContent={newContent}
          language={language}
          showGutter={showGutter}
          collapseUnchanged={collapseUnchanged}
          maxHeight={maxHeight}
        />
      ) : (
        <UnifiedDiffViewerImpl
          oldContent={oldContent}
          newContent={newContent}
          language={language}
          showGutter={showGutter}
          collapseUnchanged={collapseUnchanged}
          maxHeight={maxHeight}
        />
      )}
    </div>
  );
}

/**
 * SplitDiffViewer — 便捷组件：默认分栏视图
 */
export function SplitDiffViewer(props: Omit<FileDiffViewerProps, "viewMode">) {
  return <FileDiffViewer {...props} viewMode="split" />;
}

/**
 * UnifiedDiffViewer — 便捷组件：默认统一视图
 */
export function UnifiedDiffViewer(props: Omit<FileDiffViewerProps, "viewMode">) {
  return <FileDiffViewer {...props} viewMode="unified" />;
}
