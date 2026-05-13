import { useState } from "react";
import { Button } from "../../../shared/ui/Button";

export function ChatComposer({ disabled, onSend }: { disabled?: boolean; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="stack"><textarea className="textarea" value={text} onChange={(event) => setText(event.target.value)} placeholder="Continue root thread…" disabled={disabled || busy} /><Button className="primary" disabled={disabled || busy || !text.trim()} onClick={async () => { setBusy(true); try { await onSend(text); setText(""); } finally { setBusy(false); } }}>{busy ? "Sending…" : "Send"}</Button></div>;
}

