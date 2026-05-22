/**
 * `useWindowTypes` — 单次拉取 `/api/windows/types` 并在内存缓存(registry 是静态的,
 * 服务启动后不变,无需 TTL)。
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

export type WindowTypeCatalogEntry = {
  type: string;
  commands: WindowCommandEntry[];
  basicKnowledgeSummary?: string;
};

let cache: Record<string, WindowTypeCatalogEntry> | null = null;
let inflight: Promise<Record<string, WindowTypeCatalogEntry>> | null = null;
const subscribers = new Set<() => void>();

async function fetchWindowTypes(): Promise<Record<string, WindowTypeCatalogEntry>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await requestJson<{ items: WindowTypeCatalogEntry[] }>("/api/windows/_shared/types");
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

export function useWindowTypes(): Record<string, WindowTypeCatalogEntry> | null {
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

/** 同步取某个 type 的 commands;catalog 未到位时返回 undefined。 */
export function getWindowTypeCommands(type: string): WindowCommandEntry[] | undefined {
  return cache?.[type]?.commands;
}
