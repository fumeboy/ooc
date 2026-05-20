import type { ThreadContext } from "../../domains/chat";
import { ChatPanel } from "../../domains/chat/components/ChatPanel";

/**
 * RightPanel — chat 主面板。
 *
 * Header（objectId / status / thread switcher）现在内联在 MainPanel 的 breadcrumb-bar 同一行，
 * 这里只保留 chat 体本身。shell 决定是否渲染 RightPanel：当 thread 没有可与 user 对话的语义
 * （如 user.root，user 不能和自己对话）时直接传 right=null，AppLayout 会切到两列布局。
 *
 * 布局对齐：MainPanel 顶部是 34px 高的 breadcrumb-bar.panel + 主 panel；RightPanel 自己只有
 * 一个 panel，且其内部 chat-body 从顶端就开始渲染对话。两列同 row 时若 RightPanel 不补一个
 * 同高的 spacer，ChatPanel 顶部内容会与 MainPanel 的 breadcrumb-bar 在同一 Y 出现，造成
 * "ChatPanel 浮在 header 之上"的视觉错觉（Issue #2 Bad #a）。
 * 这里给 .right-panel 一个空的 .breadcrumb-bar 占位条，让两列顶部对齐。
 */
export function RightPanel(props: {
  sessionId?: string;
  objectId?: string;
  threadId?: string;
  thread?: ThreadContext;
  paused?: boolean;
  pauseBusy?: boolean;
  onSend: (text: string) => Promise<void>;
  onTogglePause?: () => Promise<void>;
}) {
  return (
    <aside className="right-column gap-1">
      <div className="breadcrumb-bar panel right-breadcrumb-spacer" aria-hidden="true" />
      <div className="panel right-panel">
        <ChatPanel
          sessionId={props.sessionId}
          objectId={props.objectId}
          thread={props.thread}
          paused={props.paused}
          pauseBusy={props.pauseBusy}
          onSend={props.onSend}
          onTogglePause={props.onTogglePause}
          showComposer={isUserOwnedOrCreated(props.objectId, props.thread)}
        />
      </div>
    </aside>
  );
}

/**
 * 是否在 RightPanel 底部展示 message composer。
 *
 * 用户可以驱动消息发送的两类 thread：
 * - thread 的 owner 是 user 自己（典型：user.root，输入即触发 user.root.talk_window.say）
 * - thread 的 creator 是 user（典型：assistant 等被 user 通过 talk 派生的 callee thread；
 *   composer 走 user.root.talk_window 路由回到 callee）
 *
 * 其他 thread（如 supervisor 内部 fork 的 child）不展示 composer——LLM 自己驱动，
 * user 没有发起消息的语义入口。
 */
function isUserOwnedOrCreated(objectId: string | undefined, thread: ThreadContext | undefined): boolean {
  if (objectId === "user") return true;
  if (thread?.creatorObjectId === "user") return true;
  // 兼容旧 thread.json：缺 creatorObjectId 时看 creator window 是不是指向 user 的 talk_window
  const creator = thread?.contextWindows?.find((w) => "isCreatorWindow" in w && w.isCreatorWindow);
  if (creator && creator.type === "talk" && creator.target === "user") return true;
  return false;
}
