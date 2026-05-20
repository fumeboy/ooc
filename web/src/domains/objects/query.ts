import { useEffect, useState } from "react";
import { requestJson } from "../../transport/http";
import type { DisplayName } from "./model";

/**
 * 从 self.md 第一行派生 displayName(spec: `display_name_from_self_md`)。
 *
 * 规则:
 *   1. 读 `GET /api/stones/<objectId>/self` → `{ text }`
 *   2. split('\n')[0] → trim
 *   3. 必须形如 `# X`(允许多个 `#`,如 `## Title`),去掉前导 `#+` 与空格 → trim
 *   4. 任一步失败 / 结果空字符串 → 返回 null
 *
 * 返回 null 让上层 fallback 到原 objectId,避免空字符串渲染出"什么也没显示"。
 */
export async function fetchSelfFirstLine(objectId: string): Promise<string | null> {
  try {
    const res = await requestJson<{ text?: string }>(
      `/api/stones/${encodeURIComponent(objectId)}/self`,
    );
    const text = typeof res?.text === "string" ? res.text : "";
    if (!text) return null;
    const firstLine = text.split("\n")[0]?.trim() ?? "";
    // 必须以一个或多个 `#` 起首,再跟空白 — 标准 markdown H1/H2
    const match = firstLine.match(/^#+\s+(.+)$/);
    if (!match) return null;
    const title = (match[1] ?? "").trim();
    return title ? title : null;
  } catch {
    return null;
  }
}

/**
 * 进程内简单 LRU + TTL 缓存(共享给 useDisplayName / useDisplayNames)。
 *
 * - TTL 30s:足够避免 sidebar 滚动 / 频繁 rerender 重复请求,又能在 self.md 改写后
 *   30s 内自然刷新(与 reflectable 的"Object 通过 super flow 改 self.md → 下一次 UI 看到"对称)。
 * - LRU cap 200:10 个 stone × 几次 thrash 上限足够;远低于内存压力。
 * - in-flight Promise 去重:同一 objectId 并发请求合并成一次。
 */
const TTL_MS = 30_000;
const LRU_CAP = 200;

type CacheEntry = { displayName: string | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();
const subscribers = new Set<() => void>();

function setCache(objectId: string, displayName: string | null) {
  // touch: 删了再 set 让 Map 的插入顺序反映最近使用
  if (cache.has(objectId)) cache.delete(objectId);
  cache.set(objectId, { displayName, expiresAt: Date.now() + TTL_MS });
  // 超容量时丢最旧的(Map 的迭代顺序 = 插入顺序)
  while (cache.size > LRU_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function getCache(objectId: string): CacheEntry | undefined {
  const entry = cache.get(objectId);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(objectId);
    return undefined;
  }
  return entry;
}

function notifySubscribers() {
  subscribers.forEach((fn) => fn());
}

async function loadDisplayName(objectId: string): Promise<string | null> {
  const cached = getCache(objectId);
  if (cached) return cached.displayName;
  const existing = inflight.get(objectId);
  if (existing) return existing;
  const p = (async () => {
    const name = await fetchSelfFirstLine(objectId);
    setCache(objectId, name);
    inflight.delete(objectId);
    notifySubscribers();
    return name;
  })();
  inflight.set(objectId, p);
  return p;
}

function deriveResult(objectId: string | undefined): { displayName: string; isLoading: boolean; source: "self.md" | "fallback" } {
  if (!objectId) return { displayName: "", isLoading: false, source: "fallback" };
  const cached = getCache(objectId);
  if (!cached) return { displayName: objectId, isLoading: true, source: "fallback" };
  if (cached.displayName) return { displayName: cached.displayName, isLoading: false, source: "self.md" };
  return { displayName: objectId, isLoading: false, source: "fallback" };
}

/**
 * 同步 displayName 派生(无 React hooks,用于纯渲染函数 / option 列表内联场景)。
 *
 * 调用方需要保证某个组件已经通过 `useDisplayName(s)` 触发了加载;
 * 否则首次访问返回 fallback(objectId)。
 */
export function displayNameOf(objectId: string | undefined): string {
  return deriveResult(objectId).displayName || (objectId ?? "");
}

/**
 * `useDisplayName(objectId)` — 取单个 objectId 的语义化标题。
 *
 * 缓存命中:同步返回 `{ displayName: 标题, isLoading: false }`。
 * 未命中:返回 `{ displayName: objectId, isLoading: true }` + 异步加载完成后 rerender。
 */
export function useDisplayName(objectId: string | undefined): {
  displayName: string;
  isLoading: boolean;
  source: "self.md" | "fallback";
} {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!objectId) return;
    let cancelled = false;
    const sub = () => { if (!cancelled) forceUpdate((n) => n + 1); };
    subscribers.add(sub);
    if (!getCache(objectId)) {
      void loadDisplayName(objectId);
    }
    return () => {
      cancelled = true;
      subscribers.delete(sub);
    };
  }, [objectId]);

  return deriveResult(objectId);
}

/**
 * `useDisplayNames(objectIds)` — 批量取多个 objectId 的语义化标题。
 *
 * sidebar 等一次展示 N 个的场景使用,避免每个组件单独 useEffect 引发的 N 次 setState。
 * 内部 Promise.all 并发(10 个 stone 量级足够),共享同一 LRU 缓存。
 *
 * 返回 `Record<objectId, displayName>`:已加载的命中真实值,未加载的回落到 objectId。
 */
export function useDisplayNames(objectIds: string[] | undefined): Record<string, string> {
  const [, forceUpdate] = useState(0);
  const key = (objectIds ?? []).join(",");

  useEffect(() => {
    if (!objectIds || objectIds.length === 0) return;
    let cancelled = false;
    const sub = () => { if (!cancelled) forceUpdate((n) => n + 1); };
    subscribers.add(sub);
    const missing = objectIds.filter((id) => id && !getCache(id));
    if (missing.length > 0) {
      void Promise.all(missing.map((id) => loadDisplayName(id)));
    }
    return () => {
      cancelled = true;
      subscribers.delete(sub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const map: Record<string, string> = {};
  for (const id of objectIds ?? []) {
    map[id] = deriveResult(id).displayName || id;
  }
  return map;
}

/** 测试用:清空缓存。 */
export function __resetDisplayNameCacheForTest() {
  cache.clear();
  inflight.clear();
}
