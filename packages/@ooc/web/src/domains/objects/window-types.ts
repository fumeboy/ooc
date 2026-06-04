/**
 * `useObjectTypes` — 单次拉取 catalog 并在内存缓存(registry 是静态的,
 * 服务启动后不变,无需 TTL)。
 *
 * 2026-06-03 ooc-6 cleanup: window 语义已全面被 object 语义替代。
 * - API 路径: `/api/objects/_shared/types`
 * - 旧 hook 名 `useWindowTypes` / `getWindowTypeCommands` 已删除。
 * - 旧类型名 `WindowCommandEntry` / `WindowTypeCatalogEntry` 已删除。
 *
 * 用途:WindowDetail 想根据 `window.type` 展示该 type 上注册的 command 清单(每个 type
 * 不同,例如 file 上是 `set_range/reload/edit/close`,root 上是一长串 commands)。
 */
import { useEffect, useState } from "react";
import { requestJson } from "../../transport/http";

export type ObjectMethodEntry = {
  name: string;
  /** *_BASIC 路径下的 markdown 全文(可能 1KB+);hover 时按需展示。 */
  description?: string;
};

export type ObjectTypeCatalogEntry = {
  type: string;
  methods: ObjectMethodEntry[];
  basicKnowledgeSummary?: string;
};

let cache: Record<string, ObjectTypeCatalogEntry> | null = null;
let inflight: Promise<Record<string, ObjectTypeCatalogEntry>> | null = null;
const subscribers = new Set<() => void>();

async function fetchObjectTypes(): Promise<Record<string, ObjectTypeCatalogEntry>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await requestJson<{ items: ObjectTypeCatalogEntry[] }>(
        "/api/objects/_shared/types",
      );
      const map: Record<string, ObjectTypeCatalogEntry> = {};
      for (const e of res.items ?? []) map[e.type] = e;
      cache = map;
      for (const cb of subscribers) cb();
      return map;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useObjectTypes(): Record<string, ObjectTypeCatalogEntry> | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (cache) return;
    let active = true;
    void fetchObjectTypes().then(() => {
      if (active) force((x) => x + 1);
    });
    const sub = () => active && force((x) => x + 1);
    subscribers.add(sub);
    return () => {
      active = false;
      subscribers.delete(sub);
    };
  }, []);
  return cache;
}

/** 同步取某个 object type 的 methods;catalog 未到位时返回 undefined。 */
export function getObjectTypeMethods(type: string): ObjectMethodEntry[] | undefined {
  return cache?.[type]?.methods;
}
