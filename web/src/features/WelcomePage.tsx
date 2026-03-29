/**
 * WelcomePage — 欢迎页面
 *
 * 当没有活跃 session 时展示，居中显示输入框用于发起新 session。
 * 固定与 supervisor 对话。
 */
import { useState, useRef } from "react";
import { cn } from "../lib/utils";
import { Send } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";

interface WelcomePageProps {
  onSend: (target: string, message: string) => void;
  sending: boolean;
}

export function WelcomePage({ onSend, sending }: WelcomePageProps) {
  const isMobile = useIsMobile();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg) return;
    onSend("supervisor", msg);
    setInput("");
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className={cn("w-full", isMobile ? "px-4" : "px-8 max-w-2xl")}>
        <div className="text-center mb-8">
          <h2 className="text-lg font-medium text-[var(--foreground)] mb-1">
            What would you like to do?
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Start a conversation with supervisor
          </p>
        </div>

        <div className="border border-[var(--border)] rounded-2xl overflow-hidden focus-within:border-[var(--ring)] transition-colors backdrop-blur-md" style={{ backgroundColor: "color-mix(in srgb, var(--card) 70%, transparent)" }}>
          <div className="flex items-center gap-2.5 px-5 py-3.5">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Message supervisor..."
              disabled={sending}
              className="flex-1 bg-transparent text-sm outline-none disabled:opacity-50 placeholder:text-[var(--muted-foreground)] min-w-0"
              style={isMobile ? { fontSize: "16px" } : undefined}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="p-2 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] disabled:opacity-20 hover:opacity-90 transition-opacity shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
