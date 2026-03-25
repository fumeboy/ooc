/**
 * Sidebar —— 对象列表侧边栏
 *
 * @ref docs/哲学文档/gene.md#G1 — renders — 系统中所有对象的列表
 * @ref docs/哲学文档/gene.md#G11 — implements — 对象 UI 自我表达
 */
import { useAtom } from "jotai";
import { selectedObjectAtom } from "../store/objects";
import { cn } from "../lib/utils";
import type { ObjectSummary } from "../api/types";
import { User } from "lucide-react";

interface SidebarProps {
  objects: ObjectSummary[];
  onSelect?: () => void;
}

/** 侧边栏内容（桌面端和移动端共用） */
export function SidebarContent({ objects, onSelect }: SidebarProps) {
  const [selected, setSelected] = useAtom(selectedObjectAtom);

  /* user 置顶，其余按名称排序 */
  const sorted = [...objects].sort((a, b) => {
    if (a.name === "user") return -1;
    if (b.name === "user") return 1;
    return a.name.localeCompare(b.name);
  });

  const handleClick = (name: string) => {
    setSelected(name);
    onSelect?.();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-4 pb-2">
        <h1 className="text-[11px] font-medium text-[var(--muted-foreground)] tracking-wide uppercase px-1.5">
          OOC World
        </h1>
      </div>
      <nav className="flex-1 overflow-auto px-2 pb-2">
        {sorted.map((obj) => (
          <button
            key={obj.name}
            onClick={() => handleClick(obj.name)}
            className={cn(
              "w-full text-left px-2 py-[5px] text-sm flex items-center gap-2 rounded-[4px] transition-colors",
              selected === obj.name
                ? "bg-[var(--accent)] font-medium"
                : "hover:bg-[var(--accent)]/60",
            )}
          >
            {obj.name === "user" ? (
              <User className="w-[18px] h-[18px] text-[var(--muted-foreground)] shrink-0" />
            ) : (
              <span className="w-[18px] h-[18px] flex items-center justify-center shrink-0 text-[var(--muted-foreground)] text-[10px]">
                ●
              </span>
            )}
            <span className="truncate">{obj.name}</span>
            {obj.talkable.whoAmI && (
              <span className="ml-auto text-xs text-[var(--muted-foreground)] truncate max-w-24 opacity-70">
                {obj.talkable.whoAmI}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
