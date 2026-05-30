/**
 * Cross-component "navigate to ContextWindow" event bus.
 *
 * ooc-3 note: ContextWindows are not present in ooc-3 ThinkThread.
 * This module is a stub to satisfy TuiBlock imports — the link button
 * in tool cards is hidden when liveWindowIds is empty (ooc-3 has none).
 */
const EVENT_NAME = "ooc:navigate-window";

export interface NavigateToWindowDetail {
  windowId: string;
}

export function dispatchNavigateToWindow(windowId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<NavigateToWindowDetail>(EVENT_NAME, { detail: { windowId } }),
  );
}

export function subscribeNavigateToWindow(
  handler: (detail: NavigateToWindowDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<NavigateToWindowDetail>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
