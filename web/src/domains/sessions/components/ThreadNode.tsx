/**
 * ThreadNode — Session Threads Index 树形节点。
 *
 * 表达单个 (object, thread) 二元组的"行":
 *   状态色点  thread-title    [talks N] [↑ N] [↓ N]
 *
 * 不画跨 thread 连线 —— 那是 RelationOverlay 的职责。
 *
 * 数据契约: 取一个 ListThreadsItem + indent level + 是否被选中,
 * 不依赖任何全局 store。
 *
 * 设计参考: docs/2026-05-26-session-threads-index-design.md §6.2。
 */

import type { ListThreadsItem, ThreadStatus } from "../types";
import { humanizeThreadId } from "../../../app/layout/threadDisplay";

interface ThreadNodeProps {
  item: ListThreadsItem;
  level: number;
  active: boolean;
  onSelect: () => void;
}

/**
 * 状态色点映射 —— 与 design §6.2 表对齐。
 * 退化场景（status undefined）渲染灰色虚环。
 */
const STATUS_DOT: Record<ThreadStatus, { glyph: string; cls: string; label: string }> = {
  running: { glyph: "●", cls: "thread-node-dot-running", label: "running" },
  waiting: { glyph: "◐", cls: "thread-node-dot-waiting", label: "waiting" },
  done: { glyph: "✓", cls: "thread-node-dot-done", label: "done" },
  failed: { glyph: "✗", cls: "thread-node-dot-failed", label: "failed" },
  paused: { glyph: "⏸", cls: "thread-node-dot-paused", label: "paused" },
  ephemeral: { glyph: "○", cls: "thread-node-dot-ephemeral", label: "ephemeral" },
};

const STATUS_UNKNOWN = { glyph: "○", cls: "thread-node-dot-unknown", label: "unknown" };

export function ThreadNode({ item, level, active, onSelect }: ThreadNodeProps) {
  const status = item.status;
  const dot = status ? STATUS_DOT[status] ?? STATUS_UNKNOWN : STATUS_UNKNOWN;
  const title = deriveThreadTitle(item);
  const talkCount = item.talkPeers?.length ?? 0;
  const holdingCount = item.shares?.holding.length ?? 0;
  const lentCount = item.shares?.lentOut.length ?? 0;
  const tooltip = buildTooltip(item);

  return (
    <button
      type="button"
      className={`thread-node ${active ? "is-active" : ""}`}
      style={{ paddingLeft: 6 + level * 14 }}
      onClick={onSelect}
      title={tooltip}
      data-thread-id={item.threadId}
      data-object-id={item.objectId}
      aria-label={`thread ${item.threadId} (${dot.label})`}
    >
      <span className={`thread-node-dot ${dot.cls}`} aria-hidden>
        {dot.glyph}
      </span>
      <span className="thread-node-title">{title}</span>
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
    </button>
  );
}

/** 派生 thread 显示标题；优先用后端 item.title，否则 humanizeThreadId。 */
export function deriveThreadTitle(item: ListThreadsItem): string {
  if (item.title && item.title.trim()) return item.title.trim();
  return humanizeThreadId(item.threadId);
}

/** 构造 hover tooltip 文本（design §6.2）。 */
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
