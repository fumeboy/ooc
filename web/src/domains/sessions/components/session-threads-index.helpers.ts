/**
 * SessionThreadsIndex pure-function helpers — isolated to keep test
 * imports light (no component tree pulled in).
 */

import type { ListThreadsItem } from "../types";

export interface ObjectGroup {
  objectId: string;
  items: ListThreadsItem[];
}

/**
 * Group items by objectId and sort column order:
 * - "user" column always first
 * - others sorted by thread count desc, then alphabetically
 */
export function groupByObject(items: ListThreadsItem[]): ObjectGroup[] {
  const map = new Map<string, ListThreadsItem[]>();
  for (const it of items) {
    const arr = map.get(it.objectId) ?? [];
    arr.push(it);
    map.set(it.objectId, arr);
  }
  const groups: ObjectGroup[] = Array.from(map.entries()).map(([objectId, its]) => ({
    objectId,
    items: its,
  }));
  groups.sort((a, b) => {
    if (a.objectId === "user") return -1;
    if (b.objectId === "user") return 1;
    if (a.items.length !== b.items.length) return b.items.length - a.items.length;
    return a.objectId.localeCompare(b.objectId);
  });
  return groups;
}
