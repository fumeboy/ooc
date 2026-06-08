/**
 * pinned-sessions — 被 pin 的 session id 集合（localStorage 持久化）。
 *
 * pin 的 session 进 SessionList 顶部的 Pinned 分组（与日期分组互斥：pinned 的不再
 * 出现在日期分组）。
 *
 * 纯函数（togglePinned）便于单测；read/write 包了 SSR + localStorage 异常防护。
 */

export const PINNED_SESSIONS_STORAGE_KEY = "ooc:pinned-sessions";

/** 纯函数：toggle 一个 session id 的 pin 状态。返回新数组（不原地改）。 */
export function togglePinned(pinned: readonly string[], sessionId: string): string[] {
  if (pinned.includes(sessionId)) return pinned.filter((id) => id !== sessionId);
  return [...pinned, sessionId];
}

export function readPinned(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINNED_SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function writePinned(pinned: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify([...pinned]));
  } catch {
    // ignore: 隐私模式 / quota 满不该阻断 UI
  }
}
