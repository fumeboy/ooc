import { Copy, Info, Loader2, Wrench, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ChatLine } from "../model";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";

const ROLE_CONFIG: Record<ChatLine["role"], { prefix?: string; icon?: LucideIcon; label: string; className: string }> = {
  user: { prefix: ">", label: "user", className: "tui-user" },
  assistant: { prefix: "❯", label: "assistant", className: "tui-assistant" },
  tool: { icon: Wrench, label: "tool", className: "tui-tool" },
  notice: { icon: Info, label: "notice", className: "tui-notice" },
};

function buildCopyText(line: ChatLine) {
  if (line.kind === "message") return line.content;
  if (line.kind === "notice") return `${line.title}\n${line.content}`;
  return JSON.stringify(
    {
      toolName: line.toolName,
      callId: line.callId,
      arguments: line.argumentsText,
      output: line.outputText,
      ok: line.ok,
      pending: line.pending,
    },
    null,
    2,
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="tui-copy"
      onClick={(event) => {
        event.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={copied ? "已复制" : "复制"}
    >
      {copied ? "✓" : <Copy size={12} />}
    </button>
  );
}

export function TuiBlock({ line, loading = false }: { line: ChatLine; loading?: boolean }) {
  const config = ROLE_CONFIG[line.role];
  const PrefixIcon = config.icon;

  const renderHeader = (className = "tui-block-head", detail?: React.ReactNode, aside?: React.ReactNode) => (
    <div className={className}>
      <span className={`tui-prefix${PrefixIcon ? " tui-prefix-icon" : ""}`}>
        {PrefixIcon ? <PrefixIcon size={12} strokeWidth={2} aria-hidden="true" /> : config.prefix}
      </span>
      <span className="tui-label">{config.label}</span>
      {detail && <div className="tui-header-detail">{detail}</div>}
      {loading && <Loader2 size={12} className="tui-spinner" />}
      {aside}
      <CopyBtn text={buildCopyText(line)} />
    </div>
  );

  const renderBody = () => {
    if (line.kind === "message") {
      return (
        <>
          {renderHeader()}
          <div className="tui-block-body">
            <MarkdownContent content={line.content} />
          </div>
        </>
      );
    }

    if (line.kind === "notice") {
      return (
        <div className={`tui-notice-card is-${line.tone ?? "info"}`}>
          <div className="tui-notice-card-head">
            {renderHeader("tui-card-head tui-card-head-embedded", <span className="tui-notice-title">{line.title}</span>)}
          </div>
          <div className="tui-notice-body">
            <pre className="tui-pre tui-notice-pre">{line.content}</pre>
          </div>
        </div>
      );
    }

    return (
      <div className="tui-tool-card">
        <div className="tui-tool-shell-head">
          {renderHeader(
            "tui-card-head tui-card-head-embedded",
            <div className="tui-tool-title-row">
              <strong className="tui-tool-name">{line.toolName}</strong>
              {line.callId && <span className="tui-tool-callid">{line.callId}</span>}
            </div>,
            <span className={`tui-tool-status${line.pending ? " is-pending" : line.ok ? " is-success" : " is-fail"}`}>
              {line.pending ? "pending" : line.ok ? "ok" : "failed"}
            </span>,
          )}
        </div>
        {line.argumentsText && (
          <div className="tui-tool-section">
            <div className="tui-tool-section-label">arguments</div>
            <pre className="tui-pre tui-tool-pre">{line.argumentsText}</pre>
          </div>
        )}
        {line.outputText && (
          <div className="tui-tool-section">
            <div className="tui-tool-section-label">output</div>
            <pre className="tui-pre tui-tool-pre">{line.outputText}</pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`tui-block ${config.className}`}>
      {renderBody()}
    </div>
  );
}
