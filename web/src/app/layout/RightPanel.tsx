import type { ThreadContext } from "../../domains/chat";
import { ChatPanel } from "../../domains/chat/components/ChatPanel";
import { LayoutModeToggle, type LayoutMode } from "./LayoutModeToggle";
import { useDisplayNames } from "../../domains/objects";
import { Network } from "lucide-react";

/**
 * RightPanel — chat 主面板，顶部带一行 header（取代了原 invisible spacer）。
 *
 * Header 内容（2026-05-21 改造）：
 * - 对话对象的 displayName（取自 self.md 首行；fallback 到 objectId）
 * - "查看 context windows"按钮：把 MainPanel 切回 thread 视图（kind: "session" + thread）；
 *   常见场景是 user 看完文件后想回到 context tree 而不是手动改 URL
 * - LayoutModeToggle：切换两栏 / 三栏
 *
 * 行为契约：composer 仅当 thread 是 user 自己 own 或被 user creator 派生时显示。
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
  layoutMode: LayoutMode;
  onToggleLayoutMode: () => void;
  onShowContextWindows: () => void;
}) {
  const names = useDisplayNames(props.objectId ? [props.objectId] : []);
  const objectName = props.objectId ? names[props.objectId] ?? props.objectId : undefined;
  return (
    <aside className="right-column gap-1">
      <div className="right-header panel" aria-label="right panel header">
        <div className="right-header-title" title={props.objectId}>
          <span className="right-header-label">对话: </span>
          <span className="right-header-object">{objectName ?? "(未选择)"}</span>
        </div>
        <div className="right-header-actions">
          <button
            type="button"
            className="right-header-action"
            title="把主面板切回 thread context windows 视图"
            aria-label="查看 context windows"
            onClick={props.onShowContextWindows}
          >
            <Network size={13} strokeWidth={2} />
          </button>
          <LayoutModeToggle
            mode={props.layoutMode}
            onToggle={props.onToggleLayoutMode}
            className="right-header-action"
          />
        </div>
      </div>
      <div className="right-panel">
        <ChatPanel
          sessionId={props.sessionId}
          objectId={props.objectId}
          threadId={props.threadId}
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
