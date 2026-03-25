/**
 * SessionsList — 网站左边栏的会话列表
 *
 * 展示 user 的所有 sessions，点击选中查看聊天详情。
 * 在 Chat 模式下，当没有活跃会话时默认展示此列表。
 */
import { useEffect } from "react";
import { useAtom } from "jotai";
import {
  userSessionsAtom,
  activeSessionIdAtom,
} from "../store/session";
import { fetchSessions } from "../api/client";
import { StatusBadge } from "../components/ui/Badge";
import { cn } from "../lib/utils";
import { Plus } from "lucide-react";

export function SessionsList({ onSelect }: { onSelect?: () => void } = {}) {
  const [sessions, setSessions] = useAtom(userSessionsAtom);
  const [activeId, setActiveId] = useAtom(activeSessionIdAtom);

  /* 加载 sessions */
  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => setSessions([]));
  }, [setSessions]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
          Sessions
        </span>
        <button
          onClick={() => setActiveId(null)}
          className="p-0.5 rounded hover:bg-[var(--accent)] transition-colors text-[var(--muted-foreground)]"
          title="New session"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <nav className="flex-1 overflow-auto px-2 pb-2 space-y-0.5">
        {sessions.length === 0 ? (
          <p className="px-2 py-4 text-xs text-[var(--muted-foreground)] text-center">
            No sessions yet
          </p>
        ) : (
          sessions.map((s) => (
            <button
              key={s.taskId}
              onClick={() => { setActiveId(s.taskId); onSelect?.(); }}
              className={cn(
                "w-full text-left px-2.5 py-2 text-sm rounded-lg transition-colors",
                activeId === s.taskId ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]/60",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="truncate flex-1 text-xs">{s.firstMessage || s.taskId.slice(0, 12)}</span>
                <StatusBadge status={s.status} />
              </div>
            </button>
          ))
        )}
      </nav>
    </div>
  );
}
