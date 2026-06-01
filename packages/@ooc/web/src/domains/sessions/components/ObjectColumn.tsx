/**
 * ObjectColumn — Session Threads Index 的单 object 卡片（2026-05-27 美化版）。
 *
 * 视觉契约（design §6.1 + 美化重构）:
 *   header: avatar(initial) + displayName + 状态 chips（active/done/...）
 *   body  : threadTree（按 parentThreadId 缩进, root 顶层）
 *   footer: super flow 折叠区（isSuperFlow=true 单独列）
 *
 * 不持有数据 fetch — items 由父组件按 objectId 分组后传入。
 */

import { useMemo } from "react";
import type { ListThreadsItem } from "../types";
import { ThreadNode } from "./ThreadNode";
import { useDisplayName } from "../../objects";

interface ObjectColumnProps {
  sessionId: string;
  objectId: string;
  items: ListThreadsItem[];
  selectedThreadId?: string;
  /** 选中的 thread 来自哪个 object —— 跨栏判断本栏是否被高亮 */
  selectedObjectId?: string;
  onSelectThread: (objectId: string, threadId: string) => void;
}

interface TreeNode {
  item: ListThreadsItem;
  level: number;
}

export function ObjectColumn({
  sessionId,
  objectId,
  items,
  selectedThreadId,
  selectedObjectId,
  onSelectThread,
}: ObjectColumnProps) {
  const { displayName } = useDisplayName(objectId);
  const normalItems = useMemo(() => items.filter((i) => !i.isSuperFlow), [items]);
  const superItems = useMemo(() => items.filter((i) => i.isSuperFlow), [items]);
  const counts = useMemo(() => countByStatus(normalItems), [normalItems]);
  const flatTree = useMemo(() => buildThreadTree(normalItems), [normalItems]);
  const initial = (displayName || objectId || "?").trim().slice(0, 1).toUpperCase();
  const accent = pickAccentForObject(objectId);
  const isSelectedColumn = selectedObjectId === objectId;

  return (
    <section
      className={`threads-object-card ${isSelectedColumn ? "is-selected-column" : ""}`}
      data-object-id={objectId}
      aria-label={`object ${displayName}`}
      style={{ "--object-accent": accent } as React.CSSProperties}
    >
      <header className="threads-object-card-head">
        <span className="threads-object-card-avatar" aria-hidden>
          {initial}
        </span>
        <div className="threads-object-card-title-block">
          <span className="threads-object-card-title" title={objectId}>
            {displayName}
          </span>
          <span className="threads-object-card-id muted" title={objectId}>
            {objectId}
          </span>
        </div>
        <span className="threads-object-card-counts">
          {counts.active > 0 && (
            <span className="threads-count-chip threads-count-chip-active" title="running + waiting">
              ● {counts.active} active
            </span>
          )}
          {counts.done > 0 && (
            <span className="threads-count-chip threads-count-chip-done">✓ {counts.done}</span>
          )}
          {counts.failed > 0 && (
            <span className="threads-count-chip threads-count-chip-failed">✗ {counts.failed}</span>
          )}
          {counts.paused > 0 && (
            <span className="threads-count-chip threads-count-chip-paused">⏸ {counts.paused}</span>
          )}
        </span>
      </header>

      <div className="threads-object-card-body">
        {flatTree.length === 0 ? (
          <div className="threads-object-card-empty muted small">no threads</div>
        ) : (
          <ul className="threads-object-card-list">
            {flatTree.map(({ item, level }) => {
              const active =
                selectedObjectId === item.objectId && selectedThreadId === item.threadId;
              const disabled = item.objectId === "user" && item.threadId === "root";
              return (
                <li key={`${item.objectId}:${item.threadId}`}>
                  <ThreadNode
                    sessionId={sessionId}
                    item={item}
                    level={level}
                    active={active}
                    disabled={disabled}
                    onSelect={() => onSelectThread(item.objectId, item.threadId)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {superItems.length > 0 && (
          <details className="threads-object-card-super">
            <summary className="threads-object-card-super-head">
              <span className="threads-object-card-super-icon" aria-hidden>
                ⬢
              </span>
              super flow
              <span className="muted small">{superItems.length}</span>
            </summary>
            <ul className="threads-object-card-list">
              {superItems.map((item) => {
                const active =
                  selectedObjectId === item.objectId && selectedThreadId === item.threadId;
                return (
                  <li key={`${item.objectId}:${item.threadId}`}>
                    <ThreadNode
                      sessionId={sessionId}
                      item={item}
                      level={0}
                      active={active}
                      onSelect={() => onSelectThread(item.objectId, item.threadId)}
                    />
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

interface StatusCounts {
  active: number;
  done: number;
  failed: number;
  paused: number;
}

function countByStatus(items: ListThreadsItem[]): StatusCounts {
  const c: StatusCounts = { active: 0, done: 0, failed: 0, paused: 0 };
  for (const it of items) {
    switch (it.status) {
      case "running":
      case "waiting":
        c.active++;
        break;
      case "done":
        c.done++;
        break;
      case "failed":
        c.failed++;
        break;
      case "paused":
        c.paused++;
        break;
      default:
        break;
    }
  }
  return c;
}

/**
 * 按 objectId 派生一个稳定的 hue 值，用作 avatar 与 selected accent 边框颜色。
 * 简单 hash → HSL；保证同 object 多次进入页面颜色一致。
 */
function pickAccentForObject(objectId: string): string {
  let h = 0;
  for (let i = 0; i < objectId.length; i++) {
    h = (h * 31 + objectId.charCodeAt(i)) % 360;
  }
  // user 这个特殊 object 用中性色（区别于 agent）
  if (objectId === "user") return "hsl(220, 12%, 60%)";
  return `hsl(${h}, 55%, 55%)`;
}

export function buildThreadTree(items: ListThreadsItem[]): TreeNode[] {
  if (items.length === 0) return [];
  const byThreadId = new Map(items.map((i) => [i.threadId, i] as const));
  const isRoot = (item: ListThreadsItem) =>
    !item.parentThreadId || !byThreadId.has(item.parentThreadId);
  const roots = items.filter(isRoot).sort(byCreatedAtAsc);
  const out: TreeNode[] = [];
  const visited = new Set<string>();
  const visit = (item: ListThreadsItem, level: number) => {
    if (visited.has(item.threadId)) return;
    visited.add(item.threadId);
    out.push({ item, level });
    const children = items
      .filter((i) => i.parentThreadId === item.threadId)
      .sort(byCreatedAtAsc);
    for (const c of children) visit(c, level + 1);
  };
  for (const r of roots) visit(r, 0);
  for (const it of items) {
    if (!visited.has(it.threadId)) {
      visited.add(it.threadId);
      out.push({ item: it, level: 0 });
    }
  }
  return out;
}

function byCreatedAtAsc(a: ListThreadsItem, b: ListThreadsItem): number {
  return (a.createdAt ?? 0) - (b.createdAt ?? 0);
}
