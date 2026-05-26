/**
 * ObjectColumn — Session Threads Index 的单 object 分栏。
 *
 * 视图职责（design §6.1 + §3 multi-panel）:
 *   header: displayName + 状态计数胶囊（active/done/...）
 *   body  : threadTree（按 parentThreadId 缩进, root 顶层）
 *   footer: super flow 折叠区（isSuperFlow=true 单独列）
 *
 * 不持有数据 fetch — items 由父组件按 objectId 分组后传入。
 * 不画连线 — 那是 RelationOverlay 的职责。
 */

import { useMemo } from "react";
import type { ListThreadsItem } from "../types";
import { ThreadNode } from "./ThreadNode";
import { useDisplayName } from "../../objects";

interface ObjectColumnProps {
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
  objectId,
  items,
  selectedThreadId,
  selectedObjectId,
  onSelectThread,
}: ObjectColumnProps) {
  const { displayName } = useDisplayName(objectId);
  // 分组: 普通 threads + super flow threads（折叠区单独列）
  const normalItems = useMemo(() => items.filter((i) => !i.isSuperFlow), [items]);
  const superItems = useMemo(() => items.filter((i) => i.isSuperFlow), [items]);
  // 计数（active = running + waiting；done + failed + paused 单独 chip 化）
  const counts = useMemo(() => countByStatus(normalItems), [normalItems]);
  // 树状排列（root 在前；缩进按 parentThreadId 链）
  const flatTree = useMemo(() => buildThreadTree(normalItems), [normalItems]);

  return (
    <section
      className="threads-object-column"
      data-object-id={objectId}
      aria-label={`object ${displayName}`}
    >
      <header className="threads-object-column-head">
        <span className="threads-object-column-title" title={objectId}>
          {displayName}
        </span>
        <span className="threads-object-column-counts">
          {counts.active > 0 && (
            <span className="threads-count-chip threads-count-chip-active" title="running + waiting">
              active {counts.active}
            </span>
          )}
          {counts.done > 0 && (
            <span className="threads-count-chip threads-count-chip-done">done {counts.done}</span>
          )}
          {counts.failed > 0 && (
            <span className="threads-count-chip threads-count-chip-failed">
              failed {counts.failed}
            </span>
          )}
          {counts.paused > 0 && (
            <span className="threads-count-chip threads-count-chip-paused">
              paused {counts.paused}
            </span>
          )}
        </span>
      </header>

      <div className="threads-object-column-body">
        {flatTree.length === 0 ? (
          <div className="threads-object-column-empty muted small">no threads</div>
        ) : (
          <ul className="threads-object-column-list">
            {flatTree.map(({ item, level }) => {
              const active =
                selectedObjectId === item.objectId && selectedThreadId === item.threadId;
              return (
                <li key={`${item.objectId}:${item.threadId}`}>
                  <ThreadNode
                    item={item}
                    level={level}
                    active={active}
                    onSelect={() => onSelectThread(item.objectId, item.threadId)}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {superItems.length > 0 && (
          <details className="threads-object-column-super">
            <summary className="threads-object-column-super-head">
              <span className="threads-object-column-super-icon" aria-hidden>
                ⬢
              </span>
              super flow
              <span className="muted small">{superItems.length}</span>
            </summary>
            <ul className="threads-object-column-list">
              {superItems.map((item) => {
                const active =
                  selectedObjectId === item.objectId && selectedThreadId === item.threadId;
                return (
                  <li key={`${item.objectId}:${item.threadId}`}>
                    <ThreadNode
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
        // ephemeral / undefined — 不计入主 chip 区域
        break;
    }
  }
  return c;
}

/**
 * 把 items 按 parent-child 关系排成扁平的 (item, level) 列表。
 *
 * 规则:
 *   - root threads (无 parentThreadId, 或 parent 不在本 object) 顶层显示 (level=0)
 *   - 子 thread 跟在 parent 之后, level = parent.level + 1
 *   - 没有 parent 信息时退化为单层平铺 (level=0, 按 createdAt 升序)
 *
 * 性能: items 规模 < 50, O(n²) 足够; 实际是 O(n × depth)。
 */
export function buildThreadTree(items: ListThreadsItem[]): TreeNode[] {
  if (items.length === 0) return [];
  const byThreadId = new Map(items.map((i) => [i.threadId, i] as const));
  // root 集合: 无 parentThreadId 或 parent 不在本 object
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
  // 兜底: 没被 visit 到的 item（loop 或 parent 自指）也展示
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
