/**
 * EditorTabs — IDE 风格的文件标签栏
 *
 * 顶部展示当前 active path（面包屑），下方是 tab 切换栏。
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

  /* 将 path 拆分为面包屑段 */

  return (
    <div className="shrink-0">
      {/* Tab 栏 */}
      <div className="flex items-center gap-1 px-1 py-1 overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => (
          <button
            key={tab.path}
            onClick={() => setActivePath(tab.path)}
            className={cn(
              "group flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-sm transition-colors shrink-0 max-w-[180px]",
              activePath === tab.path
                ? "bg-[var(--accent)] text-[var(--foreground)] font-medium"
                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]/50",
            )}
          >
            <span className="truncate">{tab.label}</span>
            <span
              onClick={(e) => handleClose(tab.path, e)}
              className="rounded-xl p-0.5 hover:bg-[var(--background)] opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
