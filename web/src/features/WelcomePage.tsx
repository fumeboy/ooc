/**
 * WelcomePage — 欢迎页面
 *
 * 当没有活跃 session 时展示。
 * 展示系统简介、可用对象列表、输入框用于发起新 session。
 */
import { useState, useRef } from "react";
import { useAtomValue } from "jotai";
import { objectsAtom } from "../store/objects";
import { cn } from "../lib/utils";
import { Send } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";

interface WelcomePageProps {
  onSend: (target: string, message: string) => void;
  sending: boolean;
}

export function WelcomePage({ onSend, sending }: WelcomePageProps) {
  const isMobile = useIsMobile();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const objects = useAtomValue(objectsAtom);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg) return;
    onSend("supervisor", msg);
    setInput("");
  };

  /* 过滤掉 supervisor 和内部对象，只展示用户可交互的对象 */
  const visibleObjects = objects.filter(
    (o) => o.name !== "user" && o.talkable.whoAmI,
  );

  return (
    <div className="flex items-center justify-center h-full">
      <div className={cn("w-full", isMobile ? "px-4" : "px-8 max-w-2xl")}>
        <div className="text-center mb-6">
          <h2 className="text-lg font-medium text-[var(--foreground)] mb-1">
            OOC World
          </h2>
          <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
            每个对象都是一个活的 Agent，拥有独立的身份、记忆和能力。向 supervisor 提问，或直接与任何对象对话。
          </p>
        </div>

        {/* 对象概览 */}
        {visibleObjects.length > 0 && (
          <div className="mb-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {visibleObjects.map((obj) => (
                <div
                  key={obj.name}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)]/50 text-left"
                >
                  <ObjectAvatar name={obj.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{obj.name}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] line-clamp-2 leading-tight mt-0.5">
                      {obj.talkable.whoAmI}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
