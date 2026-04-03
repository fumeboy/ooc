// kernel/web/src/features/kanban/CommentTimeline.tsx
import { useState } from "react";
import { MarkdownContent } from "../../components/ui/MarkdownContent";
import type { KanbanComment } from "../../api/types";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface CommentTimelineProps {
  comments: KanbanComment[];
  onSubmit: (content: string) => Promise<void>;
}

export function CommentTimeline({ comments, onSubmit }: CommentTimelineProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await onSubmit(input.trim());
      setInput("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto space-y-4 p-4">
        {comments.length === 0 && (
          <p className="text-muted-foreground text-sm">暂无评论</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="border-b border-border pb-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium">
                {c.author === "user" ? "你" : c.author}
              </span>
              <span className="text-xs text-muted-foreground">{timeAgo(c.createdAt)}</span>
            </div>
            <MarkdownContent content={c.content} className="text-sm" />
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSubmit()}
          placeholder="发表评论..."
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          disabled={sending}
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || sending}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          发送
        </button>
      </div>
    </div>
  );
}
