/**
 * ThreadTimeline — renders ooc-3 thread messages as TUI-style blocks.
 * Handles discriminated union: "message" | "function_call" | "function_call_output" | "reasoning"
 * plus legacy {role, content} shape.
 */
import { useState } from "react";
import type { ThreadMessage } from "../../api";

function CollapseToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`tui-tool-collapse-toggle ${open ? "is-open" : ""}`}
      onClick={onToggle}
    >
      <span className="tui-tool-collapse-icon">▾</span>
      {open ? "collapse" : "expand"}
    </button>
  );
}

function ToolCallBlock({ msg }: { msg: Extract<ThreadMessage, { type: "function_call" }> }) {
  const [open, setOpen] = useState(false);
  const argsStr =
    typeof msg.arguments === "string"
      ? msg.arguments
      : JSON.stringify(msg.arguments, null, 2);

  return (
    <div className="tui-block tui-tool-call">
      <div className="tui-block-head">
        <span className="tui-prefix">🔧</span>
        <span className="tui-label">{msg.name}</span>
        <span className="muted small" style={{ marginLeft: 4, fontFamily: "monospace" }}>
          ({msg.call_id})
        </span>
        <CollapseToggle open={open} onToggle={() => setOpen((v) => !v)} />
      </div>
      {open && (
        <div className="tui-block-body">
          <pre className="tui-pre">{argsStr}</pre>
        </div>
      )}
    </div>
  );
}

function ToolResultBlock({ msg }: { msg: Extract<ThreadMessage, { type: "function_call_output" }> }) {
  const MAX_PREVIEW = 600;
  const output = msg.output ?? "";
  const truncated = output.length > MAX_PREVIEW;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tui-block tui-tool-result">
      <div className="tui-block-head">
        <span className="tui-prefix">↩</span>
        <span className="tui-label">{msg.name ?? "result"}</span>
        <span className="muted small" style={{ marginLeft: 4, fontFamily: "monospace" }}>
          ({msg.call_id})
        </span>
        {truncated && (
          <CollapseToggle open={expanded} onToggle={() => setExpanded((v) => !v)} />
        )}
      </div>
      <div className="tui-block-body">
        <pre className="tui-pre">
          {truncated && !expanded ? output.slice(0, MAX_PREVIEW) + "\n…" : output}
        </pre>
      </div>
    </div>
  );
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
        // Discriminated union by type
        if ("type" in msg) {
          if (msg.type === "function_call") {
            return <ToolCallBlock key={i} msg={msg} />;
          }
          if (msg.type === "function_call_output") {
            return <ToolResultBlock key={i} msg={msg} />;
          }
          if (msg.type === "reasoning") {
            return (
              <div key={i} className="tui-block tui-notice">
                <div className="tui-block-head">
                  <span className="tui-prefix">💭</span>
                  <span className="tui-label muted" style={{ fontStyle: "italic" }}>reasoning</span>
                </div>
                <div className="tui-block-body">
                  <pre className="tui-pre muted" style={{ fontStyle: "italic" }}>{msg.text}</pre>
                </div>
              </div>
            );
          }
          if (msg.type === "message") {
            const tuiClass = roleTuiClass(msg.role);
            return (
              <div key={i} className={`tui-block ${tuiClass}`}>
                <div className="tui-block-head">
                  <span className="tui-prefix">{rolePrefix(msg.role)}</span>
                  <span className="tui-label">{msg.role}</span>
                </div>
                <div className="tui-block-body">
                  <pre className="tui-pre">{msg.content}</pre>
                </div>
              </div>
            );
          }
        }
        // Legacy {role, content} shape (no `type` field)
        if ("role" in msg && "content" in msg) {
          const role = (msg as { role: string; content: unknown }).role;
          const content = (msg as { content: unknown }).content;
          const contentStr = typeof content === "string" ? content : JSON.stringify(content, null, 2);
          const tuiClass = roleTuiClass(role);
          return (
            <div key={i} className={`tui-block ${tuiClass}`}>
              <div className="tui-block-head">
                <span className="tui-prefix">{rolePrefix(role)}</span>
                <span className="tui-label">{role}</span>
              </div>
              <div className="tui-block-body">
                <pre className="tui-pre">{contentStr}</pre>
              </div>
            </div>
          );
        }
        // Unknown shape fallback
        return (
          <div key={i} className="tui-block tui-notice">
            <div className="tui-block-body">
              <pre className="tui-pre">{JSON.stringify(msg, null, 2)}</pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}
