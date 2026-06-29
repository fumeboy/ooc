/**
 * ThreadNode — Session Threads Index 树形节点。
 *
 * 行布局:
 *   [status dot] [thread title] [session-entry badge?] [t·N ↑M ↓K] [→ context btn]
 *
 * 行整体点击 = 选中（写 ?objectId=&threadId=，不切 view）；右侧 context 按钮独立 navigate
 * 到 `/flows/thread_context?...`，保留 query。
 *
 * 数据契约: 取一个 ListThreadsItem + indent level + 是否被选中 / 禁用 + sessionId（拼 context 链接）。
 */

import { Link } from "react-router";
import { Network } from "lucide-react";
import type { ListThreadsItem, ThreadStatus } from "../types";
import { humanizeThreadId } from "../../../app/layout/threadDisplay";
import { toPath } from "../../../app/routing";

interface ThreadNodeProps {
  sessionId: string;
  item: ListThreadsItem;
  level: number;
  active: boolean;
  /** user.root 不允许切换查看；disabled=true 时 row 不响应 click + muted 视觉。
   *  context 按钮仍**保留可点**——查看 user.root 的 context tree 是合法操作。 */
  disabled?: boolean;
  onSelect: () => void;
}

const STATUS_DOT: Record<ThreadStatus, { glyph: string; cls: string; label: string }> = {
  running: { glyph: "●", cls: "thread-node-dot-running", label: "running" },
  waiting: { glyph: "◐", cls: "thread-node-dot-waiting", label: "waiting" },
  done: { glyph: "✓", cls: "thread-node-dot-done", label: "done" },
  failed: { glyph: "✗", cls: "thread-node-dot-failed", label: "failed" },
  paused: { glyph: "⏸", cls: "thread-node-dot-paused", label: "paused" },
  ephemeral: { glyph: "○", cls: "thread-node-dot-ephemeral", label: "ephemeral" },
};
const STATUS_UNKNOWN = { glyph: "○", cls: "thread-node-dot-unknown", label: "unknown" };

export function ThreadNode({
  sessionId,
  item,
  level,
  active,
  disabled = false,
  onSelect,
}: ThreadNodeProps) {
  const status = item.status;
  const dot = status ? STATUS_DOT[status] ?? STATUS_UNKNOWN : STATUS_UNKNOWN;
  const title = deriveThreadTitle(item);
  const talkCount = item.talkPeers?.length ?? 0;
  const holdingCount = item.shares?.holding.length ?? 0;
  const lentCount = item.shares?.lentOut.length ?? 0;
  const tooltip = buildTooltip(item);
  const isUserRoot = item.objectId === "user" && item.threadId === "root";
  const contextHref = toPath({
    kind: "flowsView",
    view: "thread_context",
    sessionId,
    objectId: item.objectId,
    threadId: item.threadId,
  });

  return (
    <div
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? undefined : 0}
      aria-disabled={disabled}
      className={`thread-node ${active ? "is-active" : ""} ${disabled ? "is-disabled" : ""}`}
      style={{ paddingLeft: 8 + level * 14 }}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={
        disabled
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
      }
      title={tooltip}
      data-thread-id={item.threadId}
      data-object-id={item.objectId}
      aria-label={`thread ${item.threadId} (${dot.label})`}
    >
      <span className={`thread-node-dot ${dot.cls}`} aria-hidden>
        {dot.glyph}
      </span>
      <span className="thread-node-title">{title}</span>
      {isUserRoot && (
        <span className="thread-node-badge thread-node-badge-entry" title="session 主入口，不可切换查看">
          session entry
        </span>
      )}
      <span className="thread-node-chips">
        {talkCount > 0 && (
          <span className="thread-node-chip" title={`${talkCount} talk peer(s)`}>
            t·{talkCount}
          </span>
        )}
        {holdingCount > 0 && (
          <span className="thread-node-chip thread-node-chip-borrow" title={`${holdingCount} ref window(s) borrowed`}>
            ↑{holdingCount}
          </span>
        )}
        {lentCount > 0 && (
          <span className="thread-node-chip thread-node-chip-lent" title={`${lentCount} window(s) lent out`}>
            ↓{lentCount}
          </span>
        )}
      </span>
      <Link
        to={contextHref}
        className="thread-node-context-btn"
        title="查看 context windows"
        aria-label="查看 context windows"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Network size={11} strokeWidth={2} />
      </Link>
    </div>
  );
}

export function deriveThreadTitle(item: ListThreadsItem): string {
  if (item.title && item.title.trim()) return item.title.trim();
  return humanizeThreadId(item.threadId);
}

function buildTooltip(item: ListThreadsItem): string {
  const lines: string[] = [`${item.objectId} / ${item.threadId}`];
  if (item.status) lines.push(`status: ${item.status}`);
  if (item.createdAt) {
    try {
      lines.push(`created: ${new Date(item.createdAt).toISOString()}`);
    } catch {
      /* drop */
    }
  }
  if (item.parentThreadId) lines.push(`parent: ${item.parentThreadId}`);
  if (item.creatorObjectId && item.creatorThreadId) {
    lines.push(`creator: ${item.creatorObjectId}/${item.creatorThreadId}`);
  }
  const talks = item.talkPeers ?? [];
  if (talks.length > 0) {
    lines.push(
      `talks → ${talks
        .map((t) => `${t.targetObjectId}${t.targetThreadId ? "/" + t.targetThreadId : ""}`)
        .join(", ")}`,
    );
  }
  const holding = item.shares?.holding ?? [];
  if (holding.length > 0) lines.push(`borrowed: ${holding.map((h) => h.windowId).join(", ")}`);
  const lent = item.shares?.lentOut ?? [];
  if (lent.length > 0) lines.push(`lent: ${lent.map((l) => l.windowId).join(", ")}`);
  return lines.join("\n");
}
