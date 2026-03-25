/**
 * CommandPalette — Cmd+K 全局命令面板
 *
 * 支持三种模式：
 * - 默认：搜索 objects / 文件 / 会话
 * - ooc://object/xxx → 查看对象信息
 * - ooc://file/xxx → 查看文件内容
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { commandPaletteOpenAtom } from "../store/session";
import { objectsAtom } from "../store/objects";
import { oocLinkUrlAtom } from "../store/ooc-link";
import { fetchObject, fetchSharedFiles, fetchSharedFile } from "../api/client";
import { MarkdownContent } from "./ui/MarkdownContent";
import { ObjectAvatar } from "./ui/ObjectAvatar";
import { cn } from "../lib/utils";
import { Search, Box, FileText, ArrowRight, Loader } from "lucide-react";
import type { ObjectSummary, StoneData, SharedFileInfo } from "../api/types";

type PaletteMode = "search" | "object-detail" | "file-detail";

interface ObjectDetail {
  data: StoneData;
  sharedFiles: SharedFileInfo[];
}

export function CommandPalette() {
  const [open, setOpen] = useAtom(commandPaletteOpenAtom);
  const objects = useAtomValue(objectsAtom);
  const setOocLink = useSetAtom(oocLinkUrlAtom);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<PaletteMode>("search");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /* object detail */
  const [objectDetail, setObjectDetail] = useState<ObjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /* file detail */
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileTitle, setFileTitle] = useState("");
  const [fileLoading, setFileLoading] = useState(false);

  /* 全局 Cmd+K 快捷键 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setOpen]);

  /* 打开时 reset */
  useEffect(() => {
    if (open) {
      setQuery("");
      setMode("search");
      setSelectedIdx(0);
      setObjectDetail(null);
      setFileContent(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  /* 搜索结果 */
  const results = useSearchResults(objects, query, mode);

  /* 选中索引 clamp */
  useEffect(() => {
    setSelectedIdx(0);
  }, [query, mode]);

  /* 打开 object 详情 */
  const openObjectDetail = useCallback(async (name: string) => {
    setMode("object-detail");
    setDetailLoading(true);
    try {
      const [data, sharedFiles] = await Promise.all([
        fetchObject(name),
        fetchSharedFiles(name).catch(() => [] as SharedFileInfo[]),
      ]);
      setObjectDetail({ data, sharedFiles });
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  /* 打开文件详情 */
  const openFileDetail = useCallback(async (objectName: string, filename: string) => {
    setMode("file-detail");
    setFileLoading(true);
    setFileTitle(filename);
    try {
      const content = await fetchSharedFile(objectName, filename);
      setFileContent(content);
    } catch (e) {
      console.error(e);
      setFileContent("加载失败");
    } finally {
      setFileLoading(false);
    }
  }, []);

  /* 执行选中项 */
  const executeResult = useCallback((item: SearchResult) => {
    if (item.type === "object") {
      openObjectDetail(item.name);
    } else if (item.type === "ooc-url") {
      setOpen(false);
      setOocLink(item.url);
    }
  }, [openObjectDetail, setOpen, setOocLink]);

  /* 键盘导航 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      executeResult(results[selectedIdx]!);
    } else if (e.key === "Escape") {
      if (mode !== "search") {
        setMode("search");
        setQuery("");
      } else {
        setOpen(false);
      }
    } else if (e.key === "Backspace" && !query && mode !== "search") {
      setMode("search");
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          className="fixed z-50 inset-0 flex items-start justify-center pt-[12vh] pointer-events-none"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Command Palette</DialogPrimitive.Title>
          <div className="pointer-events-auto w-full max-w-xl mx-4 max-h-[60vh] bg-[var(--card)] rounded-xl shadow-[0_0_0_1px_var(--border),0_16px_70px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden">
            {/* 搜索栏 */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border)]">
              {mode === "search" ? (
                <Search className="w-4 h-4 text-[var(--muted-foreground)] shrink-0" />
              ) : mode === "object-detail" ? (
                <button onClick={() => { setMode("search"); setQuery(""); }} className="shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
              ) : (
                <button onClick={() => { setMode("search"); setQuery(""); }} className="shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                  <ArrowRight className="w-4 h-4 rotate-180" />
                </button>
              )}
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={mode === "search" ? "搜索对象、文件，或输入 ooc:// URL..." : "搜索..."}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
              />
              <kbd className="text-[10px] text-[var(--muted-foreground)] bg-[var(--muted)] px-1.5 py-0.5 rounded font-mono shrink-0">
                ⌘K
              </kbd>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-auto">
              {mode === "search" && (
                <SearchResults
                  results={results}
                  selectedIdx={selectedIdx}
                  onSelect={executeResult}
                  onHover={setSelectedIdx}
                />
              )}
              {mode === "object-detail" && (
                <ObjectDetailView
                  detail={objectDetail}
                  loading={detailLoading}
                  onOpenFile={openFileDetail}
                />
              )}
              {mode === "file-detail" && (
                <FileDetailView
                  title={fileTitle}
                  content={fileContent}
                  loading={fileLoading}
                />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ── Search types & logic ── */

type SearchResult =
  | { type: "object"; name: string; whoAmI: string }
  | { type: "ooc-url"; url: string; label: string };

function useSearchResults(objects: ObjectSummary[], query: string, mode: PaletteMode): SearchResult[] {
  if (mode !== "search") return [];

  const q = query.trim().toLowerCase();

  /* ooc:// URL 直接作为结果 */
  if (q.startsWith("ooc://")) {
    return [{ type: "ooc-url", url: query.trim(), label: query.trim() }];
  }

  /* 搜索 objects */
  const objectResults: SearchResult[] = objects
    .filter((o) => {
      if (!q) return true;
      return o.name.toLowerCase().includes(q) || o.talkable?.whoAmI?.toLowerCase().includes(q);
    })
    .map((o) => ({ type: "object" as const, name: o.name, whoAmI: o.talkable?.whoAmI ?? "" }));

  return objectResults;
}

/* ── Search Results List ── */

function SearchResults({
  results,
  selectedIdx,
  onSelect,
  onHover,
}: {
  results: SearchResult[];
  selectedIdx: number;
  onSelect: (r: SearchResult) => void;
  onHover: (i: number) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
        无匹配结果
      </div>
    );
  }

  return (
    <div className="py-1">
      {results.map((r, i) => (
        <button
          key={r.type === "object" ? r.name : r.url}
          onClick={() => onSelect(r)}
          onMouseEnter={() => onHover(i)}
          className={cn(
            "w-full text-left px-4 py-2.5 flex items-center gap-3 text-sm transition-colors",
            i === selectedIdx ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]/50",
          )}
        >
          {r.type === "object" ? (
            <>
              <ObjectAvatar name={r.name} size="sm" />
              <div className="flex-1 min-w-0">
                <span className="font-medium">{r.name}</span>
                {r.whoAmI && (
                  <span className="ml-2 text-xs text-[var(--muted-foreground)] truncate">{r.whoAmI}</span>
                )}
              </div>
              <Box className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0" />
            </>
          ) : (
            <>
              <FileText className="w-4 h-4 text-[var(--muted-foreground)] shrink-0" />
              <span className="font-mono text-xs truncate">{r.label}</span>
              <ArrowRight className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0 ml-auto" />
            </>
          )}
        </button>
      ))}
    </div>
  );
}

/* ── Object Detail View ── */

function ObjectDetailView({
  detail,
  loading,
  onOpenFile,
}: {
  detail: ObjectDetail | null;
  loading: boolean;
  onOpenFile: (objectName: string, filename: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="w-4 h-4 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }
  if (!detail) return null;

  const { data, sharedFiles } = detail;

  return (
    <div className="px-5 py-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ObjectAvatar name={data.name} size="lg" />
        <div>
          <h3 className="text-base font-bold">{data.name}</h3>
          {data.talkable?.whoAmI && (
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{data.talkable.whoAmI}</p>
          )}
        </div>
      </div>

      {/* Traits */}
      {data.traits && data.traits.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-1">Traits</p>
          <div className="flex flex-wrap gap-1">
            {data.traits.map((t) => (
              <span key={t} className="text-xs bg-[var(--accent)] px-2 py-0.5 rounded">{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Relations */}
      {data.relations && data.relations.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-1">Relations</p>
          <div className="space-y-1">
            {data.relations.map((r) => (
              <div key={r.name} className="text-xs">
                <span className="font-medium">{r.name}</span>
                <span className="text-[var(--muted-foreground)] ml-2">{r.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Functions */}
      {data.talkable?.functions && data.talkable.functions.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-1">Functions</p>
          <div className="space-y-1">
            {data.talkable.functions.map((f) => (
              <div key={f.name} className="text-xs">
                <span className="font-mono text-[var(--primary)]">{f.name}</span>
                <span className="text-[var(--muted-foreground)] ml-2">{f.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shared Files */}
      {sharedFiles.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide mb-1">Shared Files</p>
          <div className="space-y-0.5">
            {sharedFiles.map((f) => (
              <button
                key={f.name}
                onClick={() => onOpenFile(data.name, f.name)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-[var(--accent)] transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0" />
                <span className="truncate">{f.name}</span>
                <span className="ml-auto text-[10px] text-[var(--muted-foreground)] shrink-0">
                  {(f.size / 1024).toFixed(1)}KB
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── File Detail View ── */

function FileDetailView({
  title,
  content,
  loading,
}: {
  title: string;
  content: string | null;
  loading: boolean;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-[var(--muted-foreground)]" />
        <span className="text-xs font-mono text-[var(--muted-foreground)] truncate">{title}</span>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader className="w-4 h-4 animate-spin text-[var(--muted-foreground)]" />
        </div>
      ) : content ? (
        <MarkdownContent content={content} className="text-sm" />
      ) : null}
    </div>
  );
}
