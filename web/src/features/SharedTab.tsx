/**
 * SharedTab —— 对象 shared 文件浏览
 *
 * 左侧文件列表，右侧内容预览（.md 用 MarkdownContent 渲染）。
 */
import { useState, useEffect } from "react";
import { fetchSharedFiles, fetchSharedFile } from "../api/client";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { cn } from "../lib/utils";
import { useIsMobile } from "../hooks/useIsMobile";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { SharedFileInfo } from "../api/types";

interface SharedTabProps {
  objectName: string;
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SharedTab({ objectName }: SharedTabProps) {
  const [files, setFiles] = useState<SharedFileInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const isMobile = useIsMobile();

  /* 加载文件列表 */
  useEffect(() => {
    setFiles([]);
    setSelected(null);
    setContent("");
    setLoading(true);
    fetchSharedFiles(objectName)
      .then((f) => {
        setFiles(f);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [objectName]);

  /* 加载选中文件内容 */
  useEffect(() => {
    if (!selected) return;
    setContent("");
    fetchSharedFile(objectName, selected)
      .then(setContent)
      .catch(() => setContent("（加载失败）"));
  }, [objectName, selected]);

  if (loading) {
    return (
      <div className="text-sm text-[var(--muted-foreground)]">加载中...</div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="text-sm text-[var(--muted-foreground)]">
        该对象没有共享文件
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {isMobile ? (
        /* Mobile: 折叠式文件列表 */
        <>
          <button
            onClick={() => setListOpen(!listOpen)}
            className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)]/40 rounded transition-colors"
          >
            {listOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <span>{selected ?? "选择文件"}</span>
            <span className="ml-auto text-[10px]">{files.length} 个文件</span>
          </button>
          {listOpen && (
            <div className="border border-[var(--border)] rounded-lg mb-2 mx-2 overflow-auto max-h-48">
              {files.map((f) => (
                <button
                  key={f.name}
                  onClick={() => { setSelected(f.name); setListOpen(false); }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs transition-colors block",
                    selected === f.name
                      ? "bg-[var(--accent)] text-[var(--foreground)]"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50",
                  )}
                >
                  <div className="truncate">{f.name}</div>
                  <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{formatSize(f.size)}</div>
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-auto min-w-0">
            {selected ? (
              content ? (
                selected.endsWith(".md") ? (
                  <MarkdownContent content={content} />
                ) : (
                  <pre className="text-xs font-mono whitespace-pre-wrap bg-[var(--muted)] rounded p-3">{content}</pre>
                )
              ) : (
                <div className="text-sm text-[var(--muted-foreground)]">加载中...</div>
              )
            ) : (
              <div className="text-sm text-[var(--muted-foreground)] flex items-center justify-center h-full">
                选择一个文件查看内容
              </div>
            )}
          </div>
        </>
      ) : (
        /* Desktop: 双栏布局 */
        <div className="flex gap-4 h-full min-h-0">
          <div className="w-56 shrink-0 overflow-auto border-r border-[var(--border)] pr-3">
            <div className="text-xs text-[var(--muted-foreground)] mb-2 font-medium">
              共享文件 ({files.length})
            </div>
            {files.map((f) => (
              <button
                key={f.name}
                onClick={() => setSelected(f.name)}
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded text-sm transition-colors block",
                  selected === f.name
                    ? "bg-[var(--accent)] text-[var(--foreground)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50 hover:text-[var(--foreground)]",
                )}
              >
                <div className="truncate text-xs">{f.name}</div>
                <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{formatSize(f.size)}</div>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto min-w-0">
            {selected ? (
              content ? (
                selected.endsWith(".md") ? (
                  <MarkdownContent content={content} />
                ) : (
                  <pre className="text-xs font-mono whitespace-pre-wrap bg-[var(--muted)] rounded p-3">{content}</pre>
                )
              ) : (
                <div className="text-sm text-[var(--muted-foreground)]">加载中...</div>
              )
            ) : (
              <div className="text-sm text-[var(--muted-foreground)] flex items-center justify-center h-full">
                选择一个文件查看内容
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
