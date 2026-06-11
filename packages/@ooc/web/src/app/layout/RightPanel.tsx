import type { ThreadContext } from "../../domains/chat";
import { ChatPanel } from "../../domains/chat/components/ChatPanel";
import { LayoutModeToggle, type LayoutMode } from "./LayoutModeToggle";
import { useDisplayNames } from "../../domains/objects";
import { LoaderCircle, Network, Pause, Play } from "lucide-react";

/**
 * RightPanel — chat 主面板，顶部带一行 header（取代了原 invisible spacer）。
 *
 * Header (top): 对话对象 displayName + actions (Network / LayoutModeToggle)
 * Body  (mid): ChatPanel = ThreadTimeline + 可选 ChatComposer
 * Footer (bot): thread status pill + session-pause 按钮。
 *   - status pill: 反映 **thread.status** (running/paused HITL/waiting/done/failed)
 *   - pause 按钮: 反映并 toggle **session 级** paused (POST /flows/.../pause)
 *   - footer 始终展示, composer 隐藏时仍可看到 thread 状态与 session pause 入口
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
          onSend={props.onSend}
          showComposer={isUserOwnedOrCreated(props.objectId, props.thread)}
        />
      </div>
      <RightFooter
        threadStatus={props.thread?.status}
        sessionPaused={props.paused}
        pauseBusy={props.pauseBusy}
        onTogglePause={props.onTogglePause}
      />
    </aside>
  );
}

/**
 * RightFooter — 与 right-header 对称的底部条。
 *
 * 左：thread.status pill（thread 自身状态机：running / paused (HITL) / waiting / done / failed）。
 * 右：session-pause 按钮（user 主动暂停 / 恢复整个 flow 的 worker 调度）。
 *
 * 两层独立显示，避免之前"thread.status=running 但 composer 写着已暂停"的视觉矛盾。
 */
function RightFooter({
  threadStatus,
  sessionPaused = false,
  pauseBusy = false,
  onTogglePause,
}: {
  threadStatus?: string;
  sessionPaused?: boolean;
  pauseBusy?: boolean;
  onTogglePause?: () => Promise<void> | void;
}) {
  const pauseTitle = pauseBusy
    ? sessionPaused
      ? "正在恢复 session…"
      : "正在暂停 session…"
    : sessionPaused
      ? "session 已暂停 · 点击恢复"
      : "暂停整个 session";
  const pauseLabel = pauseBusy
    ? sessionPaused
      ? "恢复中"
      : "暂停中"
    : sessionPaused
      ? "已暂停 · 点击恢复"
      : "暂停 session";
  return (
    <div className="right-footer panel" aria-label="right panel footer">
      <div className="right-footer-status">
        {threadStatus ? (
          <span className={`status-pill status-pill-thread status-${threadStatus}`} title={`thread.status = ${threadStatus}`}>
            {threadStatus}
          </span>
        ) : (
          <span className="muted small">—</span>
        )}
      </div>
      <div className="right-footer-actions">
        {onTogglePause && (
          <button
            type="button"
            className={`right-footer-pause${sessionPaused ? " is-paused" : ""}`}
            aria-label={pauseTitle}
            title={pauseTitle}
            disabled={pauseBusy}
            onClick={() => void onTogglePause()}
          >
            {pauseBusy ? (
              <LoaderCircle size={13} className="chat-side-icon is-spinning" />
            ) : sessionPaused ? (
              <Play size={13} />
            ) : (
              <Pause size={13} />
            )}
            <span className="right-footer-pause-label">{pauseLabel}</span>
          </button>
        )}
      </div>
    </div>
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
  if (creator && creator.class === "talk" && creator.target === "user") return true;
  return false;
}
