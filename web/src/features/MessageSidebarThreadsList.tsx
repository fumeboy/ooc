/**
 * MessageSidebarThreadsList — MessageSidebar 的 threads 视图模式内容
 *
 * 双栏布局：
 * - 左栏：我发起的（user 主动 talk 产生的 root threads）
 * - 右栏：收到的（其他对象 talk user，按对象聚合，iMessage 风格卡片）
 *
 * 点击任一 thread / 对象分组 → 设置 currentThreadIdAtom + 切回 process view
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_MessageSidebar_threads视图.md
 */
import { useState } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import { ChevronRight } from "lucide-react";
import {
  activeSessionIdAtom,
  currentThreadIdAtom,
  messageSidebarViewAtom,
} from "../store/session";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import { cn } from "../lib/utils";
import {
  useUserThreads,
  markMessagesRead,
  type TalkToUserGroup,
  type TalkToUserThread,
} from "../hooks/useUserThreads";
import type { ProcessNode } from "../api/types";

/** 相对时间简写（刚刚 / Nm / Nh / Nd） */
function formatRelativeTime(ts: number): string {
  if (!ts) return "";
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/** 线程状态色点 */
function StatusDot({ status }: { status: ProcessNode["status"] }) {
  const color =
    status === "doing"
      ? "bg-amber-400"
      : status === "done"
      ? "bg-emerald-400"
      : "bg-slate-400";
  return <span className={cn("inline-block w-1.5 h-1.5 rounded-full", color)} />;
}

export function MessageSidebarThreadsList() {
  const sessionId = useAtomValue(activeSessionIdAtom);
  const setCurrentThreadId = useSetAtom(currentThreadIdAtom);
  const setSidebarView = useSetAtom(messageSidebarViewAtom);
  const { created_by_user, talk_to_user } = useUserThreads();
  const [expandedObject, setExpandedObject] = useState<string | null>(null);

  /** 切到某线程 → mark read + set currentThread + 切回 process view */
  const selectThread = (
    threadId: string,
    messageIds: string[] = [],
  ) => {
    if (sessionId && messageIds.length > 0) {
      markMessagesRead(sessionId, messageIds);
    }
    setCurrentThreadId(threadId);
    setSidebarView("process");
  };

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* 左栏：我发起的 */}
      <div className="flex-1 min-w-0 border-r border-[var(--border)] flex flex-col">
        <div className="px-3 py-2 text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide shrink-0">
          我发起的（{created_by_user.length}）
        </div>
        <div className="flex-1 overflow-auto px-2 pb-2 space-y-1">
          {created_by_user.length === 0 && (
            <p className="text-xs text-[var(--muted-foreground)] text-center py-4 font-mono">
              尚未发起对话
            </p>
          )}
          {created_by_user.map((t) => (
            <button
              key={`${t.objectName}:${t.threadId}`}
              onClick={() => selectThread(t.threadId)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--accent)] transition-colors text-left"
              title={`${t.objectName} · ${t.title}`}
            >
              <ObjectAvatar name={t.objectName} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">{t.title}</span>
                  <StatusDot status={t.status} />
                </div>
                <div className="text-[10px] text-[var(--muted-foreground)] font-mono truncate">
                  → {t.objectName}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 右栏：收到的（聚合） */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-3 py-2 text-[11px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide shrink-0">
          收到的（{talk_to_user.length}）
        </div>
        <div className="flex-1 overflow-auto pb-2">
          {talk_to_user.length === 0 && (
            <p className="text-xs text-[var(--muted-foreground)] text-center py-4 font-mono">
              暂无其他对象对 user 的消息
            </p>
          )}
          {talk_to_user.map((grp) => (
            <ObjectConversationCard
              key={grp.objectName}
              group={grp}
              expanded={expandedObject === grp.objectName}
              onToggle={() =>
                setExpandedObject(expandedObject === grp.objectName ? null : grp.objectName)
              }
              onSelectThread={selectThread}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 右栏单个对象的会话卡片（iMessage 风格） */
function ObjectConversationCard({
  group,
  expanded,
  onToggle,
  onSelectThread,
}: {
  group: TalkToUserGroup;
  expanded: boolean;
  onToggle: () => void;
  onSelectThread: (threadId: string, messageIds: string[]) => void;
}) {
  return (
    <div className="px-1">
      <button
        onClick={onToggle}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[var(--accent)] transition-colors text-left",
          expanded && "bg-[var(--accent)]",
        )}
      >
        <ObjectAvatar name={group.objectName} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-xs font-medium truncate">{group.objectName}</span>
            <span className="text-[10px] text-[var(--muted-foreground)] font-mono shrink-0">
              {formatRelativeTime(group.lastMessageAt)}
            </span>
          </div>
          <div className="text-[11px] text-[var(--muted-foreground)] truncate">
            {group.lastMessage || "(无消息内容)"}
          </div>
        </div>
        {group.unreadCount > 0 && (
          <span className="shrink-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold">
            {group.unreadCount > 99 ? "99+" : group.unreadCount}
          </span>
        )}
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 text-[var(--muted-foreground)] shrink-0 transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>

      {expanded && (
        <div className="mt-0.5 ml-8 mr-1 space-y-0.5">
          {group.threads.map((t) => (
            <ThreadRow
              key={t.threadId}
              thread={t}
              onClick={() => onSelectThread(t.threadId, t.messageIds)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadRow({ thread, onClick }: { thread: TalkToUserThread; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--accent)] transition-colors text-left"
      title={thread.title}
    >
      <StatusDot status={thread.status} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium truncate">{thread.title}</div>
        <div className="text-[10px] text-[var(--muted-foreground)] truncate">
          {thread.lastMessage || "(无消息内容)"}
        </div>
      </div>
      {thread.unreadCount > 0 && (
        <span className="shrink-0 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-semibold">
          {thread.unreadCount}
        </span>
      )}
      <span className="text-[9px] text-[var(--muted-foreground)] font-mono shrink-0">
        {formatRelativeTime(thread.lastMessageAt)}
      </span>
    </button>
  );
}
