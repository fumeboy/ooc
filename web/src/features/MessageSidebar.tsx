/**
 * MessageSidebar — App 级右侧消息面板
 *
 * 展示当前 session 的消息列表 + 输入框。
 * 支持 @对象 自动补全指定消息目标，默认发给 supervisor。
 * 仅在桌面端、Flows tab、有活跃 session 时显示。
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAtom, useAtomValue } from "jotai";
import {
  activeSessionIdAtom,
  activeSessionFlowAtom,
  lastFlowEventAtom,
  streamingTalkAtom,
  messageSidebarOpenAtom,
} from "../store/session";
import { talkTo, fetchFlow, fetchSessions, fetchObjects, pauseObject, resumeFlow } from "../api/client";
import { userSessionsAtom } from "../store/session";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import { TalkCard } from "../components/ui/ActionCard";
import { cn } from "../lib/utils";
import { Send, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import type { FlowMessage } from "../api/types";
import { ProgressIndicator } from "../components/ProgressIndicator";

const DEFAULT_TARGET = "supervisor";

export function MessageSidebar() {
  const [sidebarOpen, setSidebarOpen] = useAtom(messageSidebarOpenAtom);
  const activeId = useAtomValue(activeSessionIdAtom);
  const [activeFlow, setActiveFlow] = useAtom(activeSessionFlowAtom);
  const lastEvent = useAtomValue(lastFlowEventAtom);
  const streamingTalk = useAtomValue(streamingTalkAtom);
  const [, setSessions] = useAtom(userSessionsAtom);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [paused, setPaused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingSendRef = useRef<boolean>(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* @对象 自动补全 */
  const [objectNames, setObjectNames] = useState<string[]>([]);
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionRef = useRef<HTMLDivElement>(null);

  /* 加载对象列表（一次性） */
  useEffect(() => {
    fetchObjects()
      .then((objs) => setObjectNames(objs.map((o) => o.name)))
      .catch(console.error);
  }, []);

  /* 过滤 mention 候选 */
  const mentionCandidates = useMemo(() => {
    if (!showMention) return [];
    const q = mentionQuery.toLowerCase();
    return objectNames
      .filter((name) => name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [showMention, mentionQuery, objectNames]);

  /* 过滤消息：排除 user→user */
  const messages = useMemo(() => {
    if (!activeFlow) return [];
    return activeFlow.messages.filter((msg) => {
      if ((msg.from === "user" || msg.from === "human") && msg.to === "user") return false;
      return true;
    });
  }, [activeFlow]);

  /* 滚动到底部 */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingTalk]);

  /* debounced refresh */
  const debouncedRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      fetchSessions().then(setSessions).catch(console.error);
      if (activeId) {
        fetchFlow(activeId).then((serverFlow) => {
          setActiveFlow((prev) => {
            if (!prev) return serverFlow;
            const serverLast = serverFlow.messages[serverFlow.messages.length - 1];
            const prevLast = prev.messages[prev.messages.length - 1];
            if (
              prevLast &&
              (prevLast.from === "user" || prevLast.from === "human") &&
              (!serverLast || serverLast.timestamp < prevLast.timestamp)
            ) {
              return { ...serverFlow, messages: [...serverFlow.messages, prevLast] };
            }
            return serverFlow;
          });
        }).catch(console.error);
      }
    }, 300);
  }, [activeId, setSessions, setActiveFlow]);

  /* SSE 实时更新 */
  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.type === "flow:start" && pendingSendRef.current) {
      pendingSendRef.current = false;
      setSending(false);
      fetchSessions().then(setSessions).catch(console.error);
      return;
    }

    if (lastEvent.type === "flow:message" && activeFlow) {
      const msg = lastEvent.message as FlowMessage;
      setActiveFlow((prev) => {
        if (!prev) return prev;
        const dup = prev.messages.some(
          (m) => m.timestamp === msg.timestamp && m.from === msg.from && m.content === msg.content,
        );
        if (dup) return prev;
        return { ...prev, messages: [...prev.messages, msg] };
      });
    }

    if ("taskId" in lastEvent) debouncedRefresh();
  }, [lastEvent, debouncedRefresh]);

  useEffect(() => {
    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, []);

  /* 流式 talk（当前 session running 时） */
  const activeStreamingTalk = useMemo(() => {
    if (!streamingTalk || !activeFlow) return null;
    if (activeFlow.status !== "running") return null;
    return streamingTalk;
  }, [streamingTalk, activeFlow]);

  /* 选择 mention 对象 */
  const selectMention = (name: string) => {
    setTarget(name);
    setShowMention(false);
    setMentionQuery("");
    /* 移除输入框中的 @query */
    setInput((prev) => {
      const atIdx = prev.lastIndexOf("@");
      return atIdx >= 0 ? prev.slice(0, atIdx) : prev;
    });
    inputRef.current?.focus();
  };

  /* 输入变化：检测 @ 触发 */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);

    const atIdx = val.lastIndexOf("@");
    if (atIdx >= 0 && (atIdx === 0 || val[atIdx - 1] === " ")) {
      const query = val.slice(atIdx + 1);
      if (!query.includes(" ")) {
        setShowMention(true);
        setMentionQuery(query);
        setMentionIndex(0);
        return;
      }
    }
    setShowMention(false);
  };

  /* 键盘导航 mention 列表 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMention && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMention(mentionCandidates[mentionIndex]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowMention(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !showMention) {
      e.preventDefault();
      handleSend();
    }

    /* Backspace 在空输入时清除 target */
    if (e.key === "Backspace" && input === "" && target !== DEFAULT_TARGET) {
      setTarget(DEFAULT_TARGET);
    }
  };

  /* 发送消息 */
  const handleSend = async () => {
    const msg = input.trim();
    if (!msg) return;

    setSending(true);
    setInput("");

    const resumeFlowId = activeFlow ? activeFlow.taskId : undefined;

    const optimisticMsg: FlowMessage = {
      direction: "out",
      from: "user",
      to: target,
      content: msg,
      timestamp: Date.now(),
    };
    if (activeFlow && resumeFlowId) {
      setActiveFlow({
        ...activeFlow,
        messages: [...activeFlow.messages, optimisticMsg],
      });
    }

    try {
      if (resumeFlowId) {
        setSending(false);
        talkTo(target, msg, resumeFlowId).catch(console.error);
      } else {
        pendingSendRef.current = true;
        talkTo(target, msg).catch((e) => {
          console.error(e);
          pendingSendRef.current = false;
          setSending(false);
        });
      }
    } catch (e) {
      console.error(e);
      setSending(false);
    }
  };

  /* 折叠按钮（始终可见） */
  if (!sidebarOpen) {
    return (
      <div className="flex items-start pt-4 pr-1">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
          title="打开消息面板"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[400px] shrink-0 bg-[var(--background)]">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <ObjectAvatar name={target} size="sm" />
          <span className="text-sm font-medium">{target}</span>
        </div>
        <div className="flex items-center gap-1">
          {/* 暂停/继续 toggle */}
          {activeFlow && (
            <button
              onClick={async () => {
                const objName = activeFlow.stoneName;
                if (paused) {
                  await resumeFlow(objName, activeFlow.taskId).catch(console.error);
                  setPaused(false);
                } else {
                  await pauseObject(objName).catch(console.error);
                  setPaused(true);
                }
              }}
              title={paused ? "继续执行" : "暂停对象执行"}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] transition-colors",
                paused
                  ? "bg-[var(--warm)]/15 text-[var(--warm)]"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
              )}
            >
              <span className={cn(
                "relative w-6 h-3.5 rounded-full transition-colors",
                paused ? "bg-[var(--warm)]" : "bg-[var(--muted-foreground)]/30",
              )}>
                <span className={cn(
                  "absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all",
                  paused ? "left-[13px]" : "left-0.5",
                )} />
              </span>
              <span>{paused ? "paused" : "pause"}</span>
            </button>
          )}
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
            title="收起消息面板"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 迭代进度 */}
      <ProgressIndicator />

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-2 py-3 space-y-3">
        {messages.length === 0 && !activeStreamingTalk && (
          <p className="text-xs text-[var(--muted-foreground)] text-center py-8">
            输入消息开始对话，输入 @ 选择对象
          </p>
        )}
        {messages.map((msg, i) => {
          const isUser = msg.from === "user" || msg.from === "human";
          return isUser
            ? <MessageBubble key={`${msg.timestamp}-${i}`} message={msg} />
            : <TalkCard key={`${msg.timestamp}-${i}`} msg={msg} maxHeight="60vh" />;
        })}
        {/* 流式 talk */}
        {activeStreamingTalk && (
          <div className="flex gap-2">
            <ObjectAvatar name={activeStreamingTalk.from} size="sm" />
            <div className="flex-1 min-w-0">
              <span className="text-[10px] text-[var(--muted-foreground)]">
                {activeStreamingTalk.from} → {activeStreamingTalk.target}
              </span>
              <div className="mt-0.5 text-sm">
                <MarkdownContent content={activeStreamingTalk.content} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 输入框 */}
      <div className="px-3 pb-3 pt-2 shrink-0 relative">
        {/* @ mention 下拉 */}
        {showMention && mentionCandidates.length > 0 && (
          <div
            ref={mentionRef}
            className="absolute bottom-full left-3 right-3 mb-1 rounded-lg bg-[var(--popover)] border border-[var(--border)] shadow-lg overflow-hidden z-10"
          >
            {mentionCandidates.map((name, i) => (
              <button
                key={name}
                onClick={() => selectMention(name)}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-[var(--accent)] transition-colors",
                  i === mentionIndex && "bg-[var(--accent)]",
                )}
              >
                <ObjectAvatar name={name} size="sm" />
                <span>{name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 focus-within:ring-1 focus-within:ring-[var(--ring)] transition-colors bg-[var(--card)]">
          {/* target tag */}
          {target !== DEFAULT_TARGET && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--accent)] text-xs shrink-0">
              @{target}
              <button
                onClick={() => { setTarget(DEFAULT_TARGET); inputRef.current?.focus(); }}
                className="hover:text-[var(--foreground)] text-[var(--muted-foreground)]"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`给 ${target} 发消息...`}
            disabled={sending}
            className="flex-1 bg-transparent text-sm outline-none disabled:opacity-50 placeholder:text-[var(--muted-foreground)] min-w-0"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="p-1.5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] disabled:opacity-20 hover:opacity-90 transition-opacity shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 用户消息气泡（仅 user/human 消息使用） */
function MessageBubble({ message }: { message: FlowMessage }) {
  return (
    <div className="flex gap-2 flex-row-reverse">
      <ObjectAvatar name="user" size="sm" />
      <div className="flex-1 min-w-0 text-right">
        <span className="text-[10px] text-[var(--muted-foreground)]">
          {message.from} → {message.to}
        </span>
        <div className="mt-0.5 text-sm rounded-xl px-3 py-2 inline-block max-w-full text-left bg-[var(--primary)] text-[var(--primary-foreground)]">
          <MarkdownContent content={message.content} invertLinks />
        </div>
      </div>
    </div>
  );
}
