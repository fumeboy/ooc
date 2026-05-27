import { useState } from "react";
import { LoaderCircle, Pause, Play, SendHorizontal } from "lucide-react";

export function ChatComposer({
  disabled,
  paused = false,
  pauseBusy = false,
  /** 当前 thread 对方 objectId — 用于派生 placeholder（A4 fix），缺省时退回通用文案 */
  peerObjectId,
  /** 对方 displayName(从 self.md 第一行派生) — 优先用于 placeholder 文本; 缺省回退到 peerObjectId */
  peerDisplayName,
  onSend,
  onTogglePause,
}: {
  disabled?: boolean;
  paused?: boolean;
  pauseBusy?: boolean;
  peerObjectId?: string;
  peerDisplayName?: string;
  onSend: (text: string) => Promise<void>;
  onTogglePause?: () => Promise<void> | void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const cannotSend = disabled || paused || pauseBusy || busy || !text.trim();

  // Issue #5 Bad #1 fix: placeholder / button hint 都标 `(⌘↵ to send)` 却没挂任何
  // keyboard handler — 是 false advertising。这里实装:
  // - Mac: Cmd+Enter; Win/Linux: Ctrl+Enter (统一 `e.metaKey || e.ctrlKey`)
  // - 普通 Enter 保留 textarea 原生换行
  // - cannotSend 状态下 hotkey 直接 return,避免空 message 入 thread
  async function trySend() {
    if (cannotSend) return;
    setBusy(true);
    try {
      await onSend(text);
      setText("");
    } finally {
      setBusy(false);
    }
  }
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") return;
    if (!(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (cannotSend) return;
    void trySend();
  }
  const pauseLabel = pauseBusy ? (paused ? "Resuming session" : "Pausing session") : paused ? "Resume session" : "Pause session";
  const pauseLabelCN = pauseBusy ? (paused ? "恢复中" : "暂停中") : paused ? "已暂停 · 点击继续" : "点击暂停";
  // Issue #3 A4 fix: 原写死 'Continue root thread...' 与 callee thread 现实脱节。
  // 改为从 peer 派生 `Reply to <name>...`(优先 displayName,缺省回退 objectId);缺 peer 时退回通用 `Continue thread...`。
  const peerLabel = peerDisplayName || peerObjectId;
  const idlePlaceholder = peerLabel ? `Reply to ${peerLabel}…` : "Continue thread…";
  // Issue #3 A7 fix: composer send 通道只支持 ⌘↵, 在 placeholder 末尾增加 hint, 与 send button title 共同消除
  // "新用户找不到发送方式" 的体验问题。
  const placeholder = paused ? "Session paused. Resume to continue…" : `${idlePlaceholder} (⌘↵ to send)`;

  return (
    <div className="chat-composer panel">
      <div className="chat-composer-card">
        <textarea
          className="chat-composer-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || pauseBusy || busy || paused}
        />
        <button
          type="button"
          className={`chat-composer-side-btn chat-pause-btn${paused ? " is-paused" : ""}`}
          aria-label={pauseLabel}
          title={pauseLabel}
          disabled={disabled || pauseBusy || !onTogglePause}
          onClick={() => void onTogglePause?.()}
        >
          {pauseBusy ? <LoaderCircle size={16} className="chat-side-icon is-spinning" /> : paused ? <Play size={16} className="chat-side-icon" /> : <Pause size={16} className="chat-side-icon" />}
          <span className="chat-pause-label">{pauseLabelCN}</span>
        </button>
        <button
          type="button"
          className="chat-composer-side-btn chat-send-btn"
          aria-label={busy ? "Sending message (⌘↵)" : "Send message (⌘↵)"}
          title={busy ? "Sending…" : "Send (⌘↵)"}
          disabled={cannotSend}
          onClick={() => { void trySend(); }}
        >
          {busy ? <LoaderCircle size={16} className="chat-side-icon is-spinning" /> : <SendHorizontal size={16} className="chat-side-icon" />}
        </button>
      </div>
    </div>
  );
}
