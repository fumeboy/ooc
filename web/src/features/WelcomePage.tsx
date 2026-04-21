/**
 * WelcomePage — 欢迎页面
 *
 * 当没有活跃 session 时展示。
 * 展示系统简介、可用对象列表、输入框用于发起新 session。
 *
 * 交互：
 * - 对象卡片点击 → 把输入框 prefill 为 `@<objectName> ` 并 focus，用户直接继续输入消息
 * - 副标题下方提示 @ 快捷键，降低新用户发现成本（Bruce 首轮 #1 / #12）
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

/** 默认会话目标——点击对象卡片不改变它，只在输入框 prefill @<name>（后端依然先建 supervisor session） */
const DEFAULT_TARGET = "supervisor";

export function WelcomePage({ onSend, sending }: WelcomePageProps) {
  const isMobile = useIsMobile();
  const [input, setInput] = useState("");
  /** 点击对象卡片后锁定的目标对象名（供发送时使用） */
  const [pinnedTarget, setPinnedTarget] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const objects = useAtomValue(objectsAtom);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg) return;
    onSend(pinnedTarget ?? DEFAULT_TARGET, msg);
    setInput("");
    setPinnedTarget(null);
  };

  /** 点击对象卡片 → prefill 输入框并聚焦；再次点击同一对象取消 */
  const handleSelectObject = (name: string) => {
    if (pinnedTarget === name) {
      setPinnedTarget(null);
      inputRef.current?.focus();
      return;
    }
    setPinnedTarget(name);
    /* 若输入框当前已有 @prefix，先剥掉；再在前面插入新 @name */
    setInput((prev) => {
      const stripped = prev.replace(/^@\S+\s*/, "");
      return `@${name} ${stripped}`;
    });
    /* 延迟到 state 生效后再 focus 并把光标移到末尾 */
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const v = el.value;
      el.setSelectionRange(v.length, v.length);
    });
  };

  /* 过滤掉 user 和内部对象，只展示用户可交互的对象（按字母排序，顺序稳定） */
  const visibleObjects = objects
    .filter((o) => o.name !== "user" && o.talkable.whoAmI)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex items-center justify-center h-full">
      <div className={cn("w-full", isMobile ? "px-4" : "px-8 max-w-2xl")}>
        <div className="text-center mb-4">
          <h2 className="text-lg font-medium text-[var(--foreground)] mb-1">
            OOC World
          </h2>
          <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">
            每个对象都是一个活的 Agent，拥有独立的身份、记忆和能力。向 supervisor 提问，或直接与任何对象对话。
          </p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1 opacity-80">
            提示：输入 <kbd className="px-1 py-0.5 rounded bg-[var(--accent)] font-mono text-[10px]">@</kbd> 切换对象，或直接点击下方对象卡片
          </p>
        </div>

        {/* 对象概览 */}
        {visibleObjects.length > 0 && (
          <div className="mb-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {visibleObjects.map((obj) => {
                const isPinned = pinnedTarget === obj.name;
                return (
                  <button
                    key={obj.name}
                    type="button"
                    onClick={() => handleSelectObject(obj.name)}
                    title={`与 ${obj.name} 直接对话`}
                    className={cn(
                      "flex items-start gap-2 px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer",
                      isPinned
                        ? "border-[var(--primary)] bg-[var(--primary)]/10"
                        : "border-[var(--border)] bg-[var(--card)]/50 hover:bg-[var(--accent)]/60 hover:border-[var(--ring)]/60",
                    )}
                  >
                    <ObjectAvatar name={obj.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{obj.name}</div>
                      <div className="text-[10px] text-[var(--muted-foreground)] line-clamp-2 leading-tight mt-0.5">
                        {obj.talkable.whoAmI}
                      </div>
                    </div>
                  </button>
                );
              })}
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
              placeholder={pinnedTarget ? `Message ${pinnedTarget}...` : "Message supervisor..."}
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
