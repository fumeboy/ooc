/**
 * ChatComposer — faithful port from ooc-2.
 */
import { useState } from "react";
import { LoaderCircle, SendHorizontal } from "lucide-react";

export function ChatComposer({
  disabled,
  paused = false,
  peerObjectId,
  peerDisplayName,
  onSend,
}: {
  disabled?: boolean;
  paused?: boolean;
  peerObjectId?: string;
  peerDisplayName?: string;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const cannotSend = disabled || paused || busy || !text.trim();

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

  const peerLabel = peerDisplayName || peerObjectId;
  const idlePlaceholder = peerLabel ? `Reply to ${peerLabel}…` : "Continue thread…";
  const placeholder = paused ? "Thread paused…" : `${idlePlaceholder} (⌘↵ to send)`;

  return (
    <div className="chat-composer panel">
      <div className="chat-composer-card">
        <textarea
          className="chat-composer-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || busy || paused}
        />
        <button
          type="button"
          className="chat-composer-side-btn chat-send-btn"
          aria-label={busy ? "Sending message (⌘↵)" : "Send message (⌘↵)"}
          title={busy ? "Sending…" : "Send (⌘↵)"}
          disabled={cannotSend}
          onClick={() => { void trySend(); }}
        >
          {busy
            ? <LoaderCircle size={16} className="chat-side-icon is-spinning" />
            : <SendHorizontal size={16} className="chat-side-icon" />}
        </button>
      </div>
    </div>
  );
}
