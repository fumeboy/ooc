/**
 * Session Thread Tree 纯函数 helpers —— 跨 object 的会话线程树。
 *
 * 与 ObjectColumn 的 `buildThreadTree`（单 object 内按 parentThreadId 缩进）不同：
 * 这里把**整个 session 所有 object 的 thread** 组织成一片森林，父子边同时吃两类来源：
 *
 *   1. 同 object 纵向：`parentThreadId` → (objectId, parentThreadId)
 *   2. 跨 object spawn：`creatorObjectId` + `creatorThreadId` → 创建它的那个 thread
 *
 * 优先 (1)；(1) 不在 items 里时退 (2)；都没有 → 视作 root。
 * `user/root` 通常是唯一的真根，其它 object 的 thread 经 creator 链挂上去。
 *
 * 独立文件让单测只 import 工具，不连带把组件树拉进测试运行时。
 */

import type { ListThreadsItem } from "../types";

export interface ThreadTreeNode {
  item: ListThreadsItem;
  children: ThreadTreeNode[];
}

export function threadKey(objectId: string, threadId: string): string {
  return `${objectId}/${threadId}`;
}

export function itemKey(item: ListThreadsItem): string {
  return threadKey(item.objectId, item.threadId);
}

/**
 * 解析一个 thread 在森林中的父 key —— 只在父确实存在于 items 时返回，
 * 否则返回 undefined（视作 root）。自指（parent==self）也按 root 处理。
 */
function resolveParentKey(
  item: ListThreadsItem,
  byKey: Map<string, ListThreadsItem>,
): string | undefined {
  const self = itemKey(item);
  // 1) 同 object 纵向 parent
  if (item.parentThreadId) {
    const k = threadKey(item.objectId, item.parentThreadId);
    if (k !== self && byKey.has(k)) return k;
  }
  // 2) 跨 object creator
  if (item.creatorObjectId && item.creatorThreadId) {
    const k = threadKey(item.creatorObjectId, item.creatorThreadId);
    if (k !== self && byKey.has(k)) return k;
  }
  return undefined;
}

function byCreatedAtAsc(a: ThreadTreeNode, b: ThreadTreeNode): number {
  return (a.item.createdAt ?? 0) - (b.item.createdAt ?? 0);
}

/**
 * 把扁平 items 组织成跨 object 的 thread 森林。
 *
 * - 返回 root 节点数组（按 createdAt 升序），每个节点 children 同样递归排序。
 * - 父不在 items 里 / 无父信息 → 该节点为 root。
 * - 防环：若 parent 链成环（A→B→A），环上节点被当作 root 接入，不会无限递归。
 * - 不可变：构造全新的 node 对象，不改 items。
 */
export function buildSessionThreadTree(items: ListThreadsItem[]): ThreadTreeNode[] {
  if (items.length === 0) return [];
  const byKey = new Map(items.map((i) => [itemKey(i), i] as const));
  const nodes = new Map<string, ThreadTreeNode>(
    items.map((i) => [itemKey(i), { item: i, children: [] } as ThreadTreeNode]),
  );

  const parentKeyOf = new Map<string, string | undefined>();
  for (const item of items) {
    parentKeyOf.set(itemKey(item), resolveParentKey(item, byKey));
  }

  // 防环：沿 parent 链上溯，若回到自己则把该节点降级为 root。
  const effectiveParent = (k: string): string | undefined => {
    const seen = new Set<string>([k]);
    let cur = parentKeyOf.get(k);
    while (cur) {
      if (seen.has(cur)) return undefined; // 成环 → 当作 root
      seen.add(cur);
      cur = parentKeyOf.get(cur);
    }
    return parentKeyOf.get(k);
  };

  const roots: ThreadTreeNode[] = [];
  for (const item of items) {
    const k = itemKey(item);
    const node = nodes.get(k)!;
    const pk = effectiveParent(k);
    const parent = pk ? nodes.get(pk) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (n: ThreadTreeNode) => {
    n.children.sort(byCreatedAtAsc);
    for (const c of n.children) sortRec(c);
  };
  roots.sort(byCreatedAtAsc);
  for (const r of roots) sortRec(r);
  return roots;
}

export interface ThreadTreeFilter {
  /** 只保留该 object 的 thread（及其祖先链以保树形）。undefined = 不按 object 过滤。 */
  objectId?: string;
  /** 在 thread id / title 上做大小写不敏感子串匹配。空串 = 不按文本过滤。 */
  query?: string;
}

function nodeMatches(item: ListThreadsItem, filter: ThreadTreeFilter): boolean {
  if (filter.objectId && item.objectId !== filter.objectId) return false;
  const q = filter.query?.trim().toLowerCase();
  if (q) {
    const hay = `${item.threadId} ${item.title ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/**
 * 按 filter 裁剪森林：保留**自身命中**或**有后代命中**的节点；祖先被保留以维持树形。
 * 返回全新的节点（不可变），命中信息通过 `collectMatchedKeys` 单独取得用于高亮。
 */
export function pruneTree(
  roots: ThreadTreeNode[],
  filter: ThreadTreeFilter,
): ThreadTreeNode[] {
  const active = !!filter.objectId || !!filter.query?.trim();
  if (!active) return roots;
  const prune = (n: ThreadTreeNode): ThreadTreeNode | undefined => {
    const keptChildren = n.children
      .map(prune)
      .filter((c): c is ThreadTreeNode => c !== undefined);
    if (nodeMatches(n.item, filter) || keptChildren.length > 0) {
      return { item: n.item, children: keptChildren };
    }
    return undefined;
  };
  return roots.map(prune).filter((n): n is ThreadTreeNode => n !== undefined);
}

/** 收集**自身命中** filter 的 thread key 集合（用于 UI 高亮，区别于"祖先占位"节点）。 */
export function collectMatchedKeys(
  items: ListThreadsItem[],
  filter: ThreadTreeFilter,
): Set<string> {
  const active = !!filter.objectId || !!filter.query?.trim();
  if (!active) return new Set();
  const out = new Set<string>();
  for (const it of items) {
    if (nodeMatches(it, filter)) out.add(itemKey(it));
  }
  return out;
}

/**
 * 按 objectId 派生稳定 hue → HSL，用作 object avatar / accent 颜色；
 * 保证同 object 多次进入页面颜色一致。user 用中性色区别于 agent。
 */
export function pickAccentForObject(objectId: string): string {
  let h = 0;
  for (let i = 0; i < objectId.length; i++) {
    h = (h * 31 + objectId.charCodeAt(i)) % 360;
  }
  if (objectId === "user") return "hsl(220, 12%, 60%)";
  return `hsl(${h}, 55%, 55%)`;
}

/** 列出 items 里出现过的 objectId（按 thread 数降序、user 优先），供 filter 下拉用。 */
export function listObjectIds(items: ListThreadsItem[]): string[] {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.objectId, (counts.get(it.objectId) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => {
      if (a[0] === "user") return -1;
      if (b[0] === "user") return 1;
      if (a[1] !== b[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([objectId]) => objectId);
}
