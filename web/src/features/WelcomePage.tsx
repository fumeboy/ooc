/**
 * WelcomePage — 欢迎页面
 *
 * 当没有活跃 session 时展示，居中显示对话框用于发起新 session。
 */
import { useState, useRef, useEffect } from "react";
import { useAtomValue } from "jotai";
import { objectsAtom } from "../store/objects";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import { cn } from "../lib/utils";
import { Send, AtSign, X } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";

interface WelcomePageProps {
  onSend: (target: string, message: string) => void;
  sending: boolean;
}

export function WelcomePage({ onSend, sending }: WelcomePageProps) {
  const objects = useAtomValue(objectsAtom);
  const isMobile = useIsMobile();
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<string | null>("supervisor");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const mentionRef = useRef<HTMLDivElement>(null);

  const mentionableObjects = objects
    .filter((o) => o.name !== "user" && o.name !== "world")
    .filter((o) => !mentionFilter || o.name.toLowerCase().includes(mentionFilter.toLowerCase()));

  const selectTarget = (name: string) => {
    setTarget(name);
    setMentionOpen(false);
    setMentionFilter("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || !target) return;
    onSend(target, msg);
    setInput("");
  };

  /* 点击外部关闭 mention 下拉框 */
  useEffect(() => {
    if (!mentionOpen) return;
    const handler = (e: MouseEvent) => {
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) {
        setMentionOpen(false);
        setMentionFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mentionOpen]);

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className={cn("w-full", isMobile ? "px-4" : "px-8 max-w-2xl")}>
        {/* 问候语 */}
        <div className="text-center mb-8">
          <h2 className="text-lg font-medium text-[var(--foreground)] mb-1">
            What would you like to do?
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Pick an object and start a conversation
          </p>
        </div>

        {/* 居中输入框 */}
        <div className="relative">
          {/* @ Mention 下拉框 */}
          {mentionOpen && (
            <div
              ref={mentionRef}
              className={cn(
                "absolute bottom-full mb-2 left-0 panel-decorated overflow-hidden z-10",
                isMobile ? "w-full" : "w-60",
              )}
            >
              <div className="px-3 py-2.5 border-b border-[var(--border)]">
                <input
                  type="text"
                  value={mentionFilter}
                  onChange={(e) => setMentionFilter(e.target.value)}
                  placeholder="Search objects..."
                  className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
                  autoFocus
                />
              </div>
              <div className="max-h-48 overflow-auto py-1">
                {mentionableObjects.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">No matches</p>
                ) : (
                  mentionableObjects.map((o) => (
                    <button
                      key={o.name}
                      onClick={() => selectTarget(o.name)}
                      className={cn(
                        "w-full text-left px-3 text-sm hover:bg-[var(--accent)] transition-colors flex items-center gap-2.5",
                        isMobile ? "py-3" : "py-2",
                      )}
                    >
                      <ObjectAvatar name={o.name} size="sm" />
                      <span className="font-medium">{o.name}</span>
                      {o.talkable?.whoAmI && (
                        <span className="ml-auto text-xs text-[var(--muted-foreground)] truncate max-w-32">
                          {o.talkable.whoAmI}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 输入框 — 与 ChatPage 浮动输入框同风格 */}
          <div className="border border-[var(--border)] rounded-2xl overflow-hidden focus-within:border-[var(--ring)] transition-colors backdrop-blur-md" style={{ backgroundColor: "color-mix(in srgb, var(--card) 70%, transparent)" }}>
            <div className="flex items-center gap-2.5 px-5 py-3.5">
              {target ? (
                <button
                  onClick={() => { setTarget(null); setMentionOpen(true); }}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-[var(--accent)] text-xs font-medium shrink-0 hover:bg-[var(--muted)] transition-colors"
                >
                  <ObjectAvatar name={target} size="sm" />
                  {target}
                  <X className="w-3 h-3 text-[var(--muted-foreground)]" />
                </button>
              ) : (
                <button
                  onClick={() => setMentionOpen(!mentionOpen)}
                  className="p-1.5 rounded-full text-[var(--muted-foreground)] hover:bg-[var(--accent)] transition-colors shrink-0"
                  title="Pick an object"
                >
                  <AtSign className="w-4 h-4" />
                </button>
              )}

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
                  if (e.key === "@" && !target) {
                    e.preventDefault();
                    setMentionOpen(true);
                  }
                }}
                placeholder={target ? `Message ${target}...` : "Pick an object first"}
                disabled={sending}
                className="flex-1 bg-transparent text-sm outline-none disabled:opacity-50 placeholder:text-[var(--muted-foreground)] min-w-0"
                style={isMobile ? { fontSize: "16px" } : undefined}
              />

              <button
                onClick={handleSend}
                disabled={!input.trim() || !target || sending}
                className="p-2 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] disabled:opacity-20 hover:opacity-90 transition-opacity shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 快捷选择对象卡片 */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {objects
            .filter((o) => o.name !== "user" && o.name !== "world")
            .sort((a, b) => (a.name === "supervisor" ? -1 : b.name === "supervisor" ? 1 : 0))
            .map((o) => (
              <button
                key={o.name}
                onClick={() => selectTarget(o.name)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--border)] text-sm transition-colors",
                  target === o.name
                    ? "bg-[var(--accent)] border-[var(--ring)]"
                    : "hover:bg-[var(--accent)]/60",
                )}
              >
                <ObjectAvatar name={o.name} size="sm" />
                <span className="font-medium">{o.name}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
