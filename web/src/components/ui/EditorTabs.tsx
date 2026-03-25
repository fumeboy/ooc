/**
 * EditorTabs — IDE 风格的文件标签栏
 *
 * 类似 VSCode 的 tabs，支持切换和关闭。
 */
import { useAtom } from "jotai";
import { editorTabsAtom, activeFilePathAtom } from "../../store/session";
import { cn } from "../../lib/utils";
import { X } from "lucide-react";

export function EditorTabs() {
  const [tabs, setTabs] = useAtom(editorTabsAtom);
  const [activePath, setActivePath] = useAtom(activeFilePathAtom);

  if (tabs.length === 0) return null;

  const handleClose = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = tabs.filter((t) => t.path !== path);
    setTabs(next);
    if (activePath === path) {
      setActivePath(next.length > 0 ? next[next.length - 1]!.path : null);
    }
  };

  return (
    <div className="flex items-center border-b border-[var(--border)] bg-[var(--background)] overflow-x-auto scrollbar-hide shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.path}
          onClick={() => setActivePath(tab.path)}
          className={cn(
            "group flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-[var(--border)] transition-colors shrink-0 max-w-[180px]",
            activePath === tab.path
              ? "bg-[var(--background)] text-[var(--foreground)]"
              : "bg-[var(--muted)]/50 text-[var(--muted-foreground)] hover:bg-[var(--accent)]/40",
          )}
        >
          <span className="truncate">{tab.label}</span>
          <span
            onClick={(e) => handleClose(tab.path, e)}
            className="rounded p-0.5 hover:bg-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="w-3 h-3" />
          </span>
        </button>
      ))}
    </div>
  );
}
