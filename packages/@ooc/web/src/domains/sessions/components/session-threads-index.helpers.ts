/**
 * SessionThreadsIndex 纯函数 helpers —— 独立文件让单测可以仅 import 工具,
 * 不连带把 SessionThreadsIndex 组件树（含 ChatPanel → MarkdownContent → rehype-raw）
 * 拉到测试运行时, 避开 dev-only 依赖缺失对单测的污染。
 */

import type { ListThreadsItem } from "../types";

export interface ObjectGroup {
  objectId: string;
  items: ListThreadsItem[];
}

/**
 * 把 items 按 objectId 分组 + 排序栏次序。
 *  - user 列总是第一个（user 视角的"首"对象）
 *  - 其它按 thread 数降序; 同数按 objectId 字典序
 */
export function groupByObject(items: ListThreadsItem[]): ObjectGroup[] {
  const map = new Map<string, ListThreadsItem[]>();
  for (const it of items) {
    const arr = map.get(it.objectId) ?? [];
    arr.push(it);
    map.set(it.objectId, arr);
  }
  const groups: ObjectGroup[] = Array.from(map.entries()).map(([objectId, items]) => ({
    objectId,
    items,
  }));
  groups.sort((a, b) => {
    if (a.objectId === "user") return -1;
    if (b.objectId === "user") return 1;
    if (a.items.length !== b.items.length) return b.items.length - a.items.length;
    return a.objectId.localeCompare(b.objectId);
  });
  return groups;
}
