/**
 * 跨组件的"导航到 ContextWindow"消息总线。
 *
 * 用法:
 * - 任何想触发跳转的 UI(如 ChatPanel 的 tool card link)调 dispatchNavigateToWindow(windowId)。
 * - ContextSnapshotViewer 在 mount 时 subscribeNavigateToWindow,收到事件后展开父链并 select。
 *
 * 用 CustomEvent 而不是 jotai 是因为目前没引入 jotai 实际使用,加一个小事件总线更轻。
 */
const EVENT_NAME = "ooc:navigate-window";

export interface NavigateToWindowDetail {
  /** 目标 window id(如 "w_creator_xxx" 或 form id "f_xxx")。 */
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
