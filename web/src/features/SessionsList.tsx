/**
 * SessionsList — 网站左边栏的会话列表
 *
 * 展示 user 的所有 sessions，支持虚拟分组。
 * 分组配置从 .flows.json 读取。
 */
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import {
  userSessionsAtom,
  activeSessionIdAtom,
  activeFilePathAtom,
  editorTabsAtom,
} from "../store/session";
import { fetchSessions, fetchFlowGroups, type GroupConfig } from "../api/client";
import { StatusBadge } from "../components/ui/Badge";
import { cn } from "../lib/utils";
import { Plus, ChevronRight, ChevronDown, Folder, Settings } from "lucide-react";
import type { FlowSummary } from "../api/types";

/** 将时间戳转为日期分组标签 */
function getDateLabel(ts: number): string {
  const now = new Date();
  const date = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (target.getTime() === today.getTime()) return "今天";
  if (target.getTime() === yesterday.getTime()) return "昨天";

  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86400000);
  if (diffDays < 7) return "最近 7 天";
  if (diffDays < 30) return "最近 30 天";

  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function SessionsList({ onSelect, onEditGroups }: { onSelect?: () => void; onEditGroups?: () => void } = {}) {
  const [sessions, setSessions] = useAtom(userSessionsAtom);
  const [activeId, setActiveId] = useAtom(activeSessionIdAtom);
  const [, setActivePath] = useAtom(activeFilePathAtom);
  const [, setTabs] = useAtom(editorTabsAtom);
  const [groups, setGroups] = useState<GroupConfig["groups"]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  /* 加载 sessions + groups */
  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => setSessions([]));
    fetchFlowGroups().then((c) => setGroups(c.groups ?? [])).catch(() => {});
  }, [setSessions]);

  /* 按分组整理 sessions */
  const memberToGroup = new Map<string, string>();
  const memberDesc = new Map<string, string>();
  for (const g of groups) {
    for (const m of g.members) {
      memberToGroup.set(m.memberId, g.groupName);
      if (m.description) memberDesc.set(m.memberId, m.description);
    }
  }

  const grouped = new Map<string, FlowSummary[]>();
  const ungrouped: FlowSummary[] = [];
  for (const s of sessions) {
    const groupName = memberToGroup.get(s.sessionId);
    if (groupName) {
      if (!grouped.has(groupName)) grouped.set(groupName, []);
      grouped.get(groupName)!.push(s);
    } else {
      ungrouped.push(s);
    }
  }

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  /* 按日期分组未分组的 sessions */
  const dateGrouped = new Map<string, FlowSummary[]>();
  for (const s of ungrouped) {
    const label = getDateLabel(s.createdAt);
    if (!dateGrouped.has(label)) dateGrouped.set(label, []);
    dateGrouped.get(label)!.push(s);
  }
  const dateGroups = Array.from(dateGrouped.entries());

  const renderSession = (s: FlowSummary) => {
    const desc = memberDesc.get(s.sessionId);
    const label = desc || s.title || s.firstMessage || s.sessionId.slice(0, 12);
    return (
      <button
        key={s.sessionId}
        onClick={() => {
            const path = `flows/${s.sessionId}`;
            setActiveId(s.sessionId);
            setActivePath(path);
            setTabs((prev) => {
              if (prev.some((t) => t.path === path)) return prev;
              return [...prev, { path, label: "Kanban" }];
            });
            onSelect?.();
          }}
        className={cn(
          "w-full text-left px-2.5 py-2 text-sm rounded-lg transition-colors",
          activeId === s.sessionId ? "bg-[var(--accent)]" : "hover:bg-[var(--accent)]/60",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="truncate flex-1 text-xs">{label}</span>
          <StatusBadge status={s.status} />
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
          Sessions
        </span>
        <div className="flex items-center gap-0.5">
          {onEditGroups && (
            <button
              onClick={onEditGroups}
              className="p-0.5 rounded hover:bg-[var(--accent)] transition-colors text-[var(--muted-foreground)]"
              title="编辑分组配置"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => {
              setActiveId(null);
              setActivePath(null);
              setTabs([]);
            }}
            className="p-0.5 rounded hover:bg-[var(--accent)] transition-colors text-[var(--muted-foreground)]"
            title="New session"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <nav className="flex-1 overflow-auto px-2 pb-2 space-y-0.5">
        {sessions.length === 0 ? (
          <p className="px-2 py-4 text-xs text-[var(--muted-foreground)] text-center">
            No sessions yet
          </p>
        ) : (
          <>
            {/* 分组 */}
            {groups.map((g) => {
              const items = grouped.get(g.groupName);
              if (!items || items.length === 0) return null;
              const expanded = expandedGroups.has(g.groupName);
              return (
                <div key={g.groupName}>
                  <button
                    onClick={() => toggleGroup(g.groupName)}
                    className="w-full text-left px-2 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] flex items-center gap-1.5 rounded-lg hover:bg-[var(--accent)]/40 transition-colors"
                  >
                    {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <Folder className="w-3 h-3" />
                    <span>{g.groupName}</span>
                    <span className="ml-auto text-[9px] opacity-50">{items.length}</span>
                  </button>
                  {expanded && (
                    <div className="pl-3 space-y-0.5">
                      {items.map(renderSession)}
                    </div>
                  )}
                </div>
              );
            })}
            {/* 未分组：按日期分组 */}
            {dateGroups.map(([label, items]) => (
              <div key={label}>
                <div className="px-2 pt-2 pb-1 text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
                  {label}
                </div>
                <div className="space-y-0.5">
                  {items.map(renderSession)}
                </div>
              </div>
            ))}
          </>
        )}
      </nav>
    </div>
  );
}
