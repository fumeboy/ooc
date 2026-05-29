/**
 * ThreadTimeline — renders ooc-3 thread messages as TUI-style blocks.
 * Adapted from ooc-2; uses ooc-3 ThreadMessage type.
 */
import type { ThreadMessage } from "../../api";

function messageContent(msg: ThreadMessage): string {
  if (typeof msg.content === "string") return msg.content;
  try { return JSON.stringify(msg.content, null, 2); } catch { return String(msg.content); }
}

function roleTuiClass(role: string): string {
  if (role === "user") return "tui-user";
  if (role === "assistant") return "tui-assistant";
  if (role === "tool") return "tui-tool";
  return "tui-notice";
}

function rolePrefix(role: string): string {
  if (role === "user") return "▸";
  if (role === "assistant") return "◆";
  if (role === "tool") return "⚙";
  return "•";
}

export function ThreadTimeline({ messages }: { messages: ThreadMessage[] }) {
  if (messages.length === 0) {
    return <div className="muted small" style={{ padding: "12px 8px" }}>No thread messages yet.</div>;
  }
  return (
    <div className="stack tui-thread">
      {messages.map((msg, i) => {
        const tuiClass = roleTuiClass(msg.role);
        const content = messageContent(msg);
        return (
          <div key={i} className={`tui-block ${tuiClass}`}>
            <div className="tui-block-head">
              <span className="tui-prefix">{rolePrefix(msg.role)}</span>
              <span className="tui-label">{msg.role}</span>
            </div>
            <div className="tui-block-body">
              <pre className="tui-pre">{content}</pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}
