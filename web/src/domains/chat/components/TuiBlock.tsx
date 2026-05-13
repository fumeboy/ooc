import { Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ChatLine } from "../model";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";

const ROLE_CONFIG: Record<ChatLine["role"], { prefix: string; label: string; className: string }> = {
  user: { prefix: ">", label: "user", className: "tui-user" },
  assistant: { prefix: "❯", label: "talk", className: "tui-assistant" },
  action: { prefix: "⚙", label: "action", className: "tui-action" },
};

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
  return (
    <div className={`tui-block ${config.className}`}>
      <div className="tui-block-head">
        <span className="tui-prefix">{config.prefix}</span>
        <span className="tui-label">{config.label}</span>
        {loading && <Loader2 size={12} className="tui-spinner" />}
        <CopyBtn text={line.content} />
      </div>
      <div className="tui-block-body">
        {line.role === "action" ? <pre className="tui-pre">{line.content}</pre> : <MarkdownContent content={line.content} />}
      </div>
    </div>
  );
}
