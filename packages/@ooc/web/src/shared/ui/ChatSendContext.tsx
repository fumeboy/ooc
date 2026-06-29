/**
 * ChatSendContext — 让 InlineUiComponent（如 follow-ups 选项按钮）能拿到当前 ChatPanel
 * 的 onSend 回调，避免 prop drilling 穿过 ThreadTimeline / TuiBlock / InlineUiContent。
 *
 * Provider 由 ChatPanel 在顶层挂载；非 ChatPanel 渲染场景（比如纯 markdown 预览）无需
 * Provider，组件读不到 context 时退化为不可点击 / 不渲染。
 */

import { createContext, useContext, type ReactNode } from "react";

interface ChatSendContextValue {
  onSend: (text: string) => Promise<void>;
}

const ChatSendContext = createContext<ChatSendContextValue | undefined>(undefined);

export function ChatSendProvider({
  onSend,
  children,
}: {
  onSend: (text: string) => Promise<void>;
  children: ReactNode;
}) {
  return (
    <ChatSendContext.Provider value={{ onSend }}>{children}</ChatSendContext.Provider>
  );
}

/** 取 ChatPanel 的发送回调；不在 Provider 下时返回 undefined。 */
export function useChatSend(): ((text: string) => Promise<void>) | undefined {
  return useContext(ChatSendContext)?.onSend;
}
