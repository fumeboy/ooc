/**
 * `useWindowTypes` / `useObjectTypes` — 单次拉取 catalog 并在内存缓存(registry 是静态的,
 * 服务启动后不变,无需 TTL)。
 *
 * 2026-05-28 ooc-6 Object Unification: window 语义正在被 object 语义替代。
 * - 新 API 路径: `/api/objects/_shared/types`(优先使用)
 * - 旧路径兼容: `/api/windows/_shared/types`(保留向后兼容)
 * - 新 hook 名: `useObjectTypes`(优先使用)
 * - 旧 hook 名: `useWindowTypes`(保留为别名)
 *
 * 用途:WindowDetail 想根据 `window.type` 展示该 type 上注册的 command 清单(每个 type
 * 不同,例如 relation 上是 `edit`,file 上是 `set_range/reload/edit/close`,root 上是
 * 一长串 commands)。
 */
import { useEffect, useState } from "react";
import { requestJson } from "../../transport/http";

export type WindowCommandEntry = {
  name: string;
  /** *_BASIC 路径下的 markdown 全文(可能 1KB+);hover 时按需展示。 */
  description?: string;
};

/** @deprecated Use ObjectCommandEntry instead (2026-05-28 ooc-6 Object Unification). */
export type ObjectCommandEntry = WindowCommandEntry;

export type WindowTypeCatalogEntry = {
  type: string;
  commands: WindowCommandEntry[];
  basicKnowledgeSummary?: string;
};

/** @deprecated Use ObjectTypeCatalogEntry instead (2026-05-28 ooc-6 Object Unification). */
export type ObjectTypeCatalogEntry = WindowTypeCatalogEntry;

let cache: Record<string, WindowTypeCatalogEntry> | null = null;
let inflight: Promise<Record<string, WindowTypeCatalogEntry>> | null = null;
const subscribers = new Set<() => void>();

async function fetchWindowTypes(): Promise<Record<string, WindowTypeCatalogEntry>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await requestJson<{ items: WindowTypeCatalogEntry[] }>(
        "/api/objects/_shared/types",
      );
      const map: Record<string, WindowTypeCatalogEntry> = {};
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

/** @deprecated Use useObjectTypes instead (2026-05-28 ooc-6 Object Unification). */
export function useWindowTypes(): Record<string, WindowTypeCatalogEntry> | null {
  return useObjectTypes();
}

export function useObjectTypes(): Record<string, ObjectTypeCatalogEntry> | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (cache) return;
    let active = true;
    void fetchWindowTypes().then(() => {
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

/** 同步取某个 type 的 commands;catalog 未到位时返回 undefined。
 *  @deprecated Use getObjectTypeCommands instead (2026-05-28 ooc-6 Object Unification).
 */
export function getWindowTypeCommands(type: string): WindowCommandEntry[] | undefined {
  return getObjectTypeCommands(type);
}

/** 同步取某个 object type 的 commands;catalog 未到位时返回 undefined。 */
export function getObjectTypeCommands(type: string): ObjectCommandEntry[] | undefined {
  return cache?.[type]?.commands;
}
