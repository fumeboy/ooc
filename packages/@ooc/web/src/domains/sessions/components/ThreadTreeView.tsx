/**
 * ThreadTreeView — Session Threads Index 的树形视图（取代旧"五线谱" StaffView）。
 *
 * 把整个 session 的 thread 按跨 object 森林（parentThreadId / creator 链）递归渲染：
 *
 *   ▾ user · root                       [session entry]
 *     ▾ supervisor · plan               ● t·1
 *         worker · extract              ✓
 *       supervisor · review            ◐
 *
 * - 每行：[展开 chevron] [object avatar] [ThreadNode（状态/标题/chips/→context）]
 * - 行点击 = 选中（写 ?objectId=&threadId=，不切 view）；与旧版一致。
 * - 有子节点的行可折叠；filter 命中时强制展开以便看到命中项。
 * - filter 命中的节点高亮（is-match）；仅作"祖先占位"的节点淡化（is-passthrough）。
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ListThreadsItem } from "../types";
import { ThreadNode } from "./ThreadNode";
import { useDisplayName } from "../../objects";
import {
  itemKey,
  pickAccentForObject,
  type ThreadTreeNode,
} from "./thread-tree.helpers";

interface ThreadTreeViewProps {
  sessionId: string;
  roots: ThreadTreeNode[];
  selectedObjectId?: string;
  selectedThreadId?: string;
  /** filter 自身命中的 thread key —— 命中行高亮，非命中（祖先占位）行淡化。 */
  matchedKeys: Set<string>;
  /** filter 激活时忽略折叠状态，强制全展开。 */
  filterActive: boolean;
  onSelectThread: (objectId: string, threadId: string) => void;
}

export function ThreadTreeView({
  sessionId,
  roots,
  selectedObjectId,
  selectedThreadId,
  matchedKeys,
  filterActive,
  onSelectThread,
}: ThreadTreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const allKeysWithChildren = useMemo(() => {
    const keys: string[] = [];
    const walk = (n: ThreadTreeNode) => {
      if (n.children.length > 0) keys.push(itemKey(n.item));
      n.children.forEach(walk);
    };
    roots.forEach(walk);
    return keys;
  }, [roots]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allKeysWithChildren));

  return (
    <div className="threads-tree" role="tree" aria-label="session thread tree">
      <div className="threads-tree-toolbar">
        <button
          type="button"
          className="threads-tree-toolbar-btn"
          onClick={expandAll}
          disabled={filterActive}
          title="展开所有分支"
        >
          展开全部
        </button>
        <span className="threads-tree-toolbar-sep" aria-hidden>
          ·
        </span>
        <button
          type="button"
          className="threads-tree-toolbar-btn"
          onClick={collapseAll}
          disabled={filterActive}
          title="折叠所有分支"
        >
          折叠全部
        </button>
        {filterActive && (
          <span className="threads-tree-toolbar-hint muted small">
            过滤中 · 强制展开
          </span>
        )}
      </div>
      <ul className="threads-tree-list" role="group">
        {roots.map((node) => (
          <TreeRow
            key={itemKey(node.item)}
            sessionId={sessionId}
            node={node}
            level={0}
            collapsed={collapsed}
            filterActive={filterActive}
            matchedKeys={matchedKeys}
            selectedObjectId={selectedObjectId}
            selectedThreadId={selectedThreadId}
            onToggle={toggle}
            onSelectThread={onSelectThread}
          />
        ))}
      </ul>
    </div>
  );
}

interface TreeRowProps {
  sessionId: string;
  node: ThreadTreeNode;
  level: number;
  collapsed: Set<string>;
  filterActive: boolean;
  matchedKeys: Set<string>;
  selectedObjectId?: string;
  selectedThreadId?: string;
  onToggle: (key: string) => void;
  onSelectThread: (objectId: string, threadId: string) => void;
}

function TreeRow({
  sessionId,
  node,
  level,
  collapsed,
  filterActive,
  matchedKeys,
  selectedObjectId,
  selectedThreadId,
  onToggle,
  onSelectThread,
}: TreeRowProps) {
  const { item, children } = node;
  const key = itemKey(item);
  const hasChildren = children.length > 0;
  const isCollapsed = !filterActive && collapsed.has(key);
  const active =
    selectedObjectId === item.objectId && selectedThreadId === item.threadId;
  const disabled = item.objectId === "user" && item.threadId === "root";
  // filter 激活时：自身命中 → 高亮；仅作祖先占位 → 淡化
  const isMatch = matchedKeys.has(key);
  const passthrough = filterActive && !isMatch;

  return (
    <li className="threads-tree-item" role="treeitem" aria-expanded={hasChildren ? !isCollapsed : undefined}>
      <div
        className={`threads-tree-row ${isMatch ? "is-match" : ""} ${passthrough ? "is-passthrough" : ""}`}
        style={{ paddingLeft: 6 + level * 16 }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="threads-tree-twisty"
            onClick={() => onToggle(key)}
            aria-label={isCollapsed ? "展开" : "折叠"}
            title={isCollapsed ? "展开" : "折叠"}
            disabled={filterActive}
          >
            {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : (
          <span className="threads-tree-twisty threads-tree-twisty-leaf" aria-hidden />
        )}
        <ObjectAvatar objectId={item.objectId} />
        <ThreadNode
          sessionId={sessionId}
          item={item}
          level={0}
          active={active}
          disabled={disabled}
          onSelect={() => onSelectThread(item.objectId, item.threadId)}
        />
      </div>
      {hasChildren && !isCollapsed && (
        <ul className="threads-tree-list" role="group">
          {children.map((child) => (
            <TreeRow
              key={itemKey(child.item)}
              sessionId={sessionId}
              node={child}
              level={level + 1}
              collapsed={collapsed}
              filterActive={filterActive}
              matchedKeys={matchedKeys}
              selectedObjectId={selectedObjectId}
              selectedThreadId={selectedThreadId}
              onToggle={onToggle}
              onSelectThread={onSelectThread}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ObjectAvatar({ objectId }: { objectId: string }) {
  const { displayName } = useDisplayName(objectId);
  const initial = (displayName || objectId || "?").trim().slice(0, 1).toUpperCase();
  const accent = pickAccentForObject(objectId);
  return (
    <span
      className="threads-tree-avatar"
      style={{ "--object-accent": accent } as React.CSSProperties}
      title={`${displayName} (${objectId})`}
      aria-hidden
    >
      {initial}
    </span>
  );
}
