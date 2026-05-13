import { useState } from "react";
import { LoaderCircle, Pause, Play, SendHorizontal } from "lucide-react";

export function ChatComposer({
  disabled,
  paused = false,
  pauseBusy = false,
  onSend,
  onTogglePause,
}: {
  disabled?: boolean;
  paused?: boolean;
  pauseBusy?: boolean;
  onSend: (text: string) => Promise<void>;
  onTogglePause?: () => Promise<void> | void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const cannotSend = disabled || paused || pauseBusy || busy || !text.trim();
  const pauseLabel = pauseBusy ? (paused ? "Resuming session" : "Pausing session") : paused ? "Resume session" : "Pause session";

  return (
    <div className="chat-composer panel">
      <div className="chat-composer-card">
        <textarea
          className="chat-composer-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={paused ? "Session paused. Resume to continue…" : "Continue root thread…"}
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
        </button>
        <button
          type="button"
          className="chat-composer-side-btn chat-send-btn"
          aria-label={busy ? "Sending message" : "Send message"}
          disabled={cannotSend}
          onClick={async () => {
            if (cannotSend) return;
            setBusy(true);
            try {
              await onSend(text);
              setText("");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <LoaderCircle size={16} className="chat-side-icon is-spinning" /> : <SendHorizontal size={16} className="chat-side-icon" />}
        </button>
      </div>
    </div>
  );
}
