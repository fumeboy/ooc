/**
 * nav-history — 最近访问的 path 历史（localStorage 持久化）。
 *
 * 只记 **path**（pathname），不记 query param、不记 domain/origin。用于 breadcrumb 旁的
 * history 按钮：hover 弹出最近访问列表，点击跳转。
 *
 * 规则：
 * - 去重（同一 path 只保留一条）
 * - 最新在前
 * - 上限 MAX_HISTORY 条
 *
 * 纯函数（pushHistory）便于单测；read/write 包了 SSR + localStorage 异常防护。
 */

export const NAV_HISTORY_STORAGE_KEY = "ooc:nav-history";
export const MAX_HISTORY = 10;

/**
 * 纯函数：把 path 推入历史列表。去重（移除已存在的同 path）→ 置顶 → 截断到上限。
 * 空白 path 原样返回（不记录）。
 */
export function pushHistory(history: readonly string[], path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) return [...history];
  const deduped = history.filter((p) => p !== trimmed);
  return [trimmed, ...deduped].slice(0, MAX_HISTORY);
}

export function readHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(NAV_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string").slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function writeHistory(history: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NAV_HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // ignore: 隐私模式 / quota 满不该阻断导航
  }
}

/**
 * 记录一次访问（path-only）。读出当前历史 → pushHistory → 写回。若 path 已在最前则
 * 不重复写（避免无谓 localStorage 写入）。返回更新后的历史列表。
 */
export function recordVisit(path: string): string[] {
  const current = readHistory();
  const next = pushHistory(current, path);
  if (next[0] === current[0] && next.length === current.length) {
    // 顶部未变（同 path 重复访问且无截断）→ 不写。
    const same = next.every((p, i) => p === current[i]);
    if (same) return current;
  }
  writeHistory(next);
  return next;
}
