/**
 * ChatPage — 聊天主页面
 *
 * 浮动圆角输入框居中固定在底部，@ 按钮选择对话对象，
 * 聊天记录占据主要部分。Sessions 列表已移至网站左边栏。
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAtom, useAtomValue } from "jotai";
import {
  userSessionsAtom,
  activeSessionIdAtom,
  activeSessionFlowAtom,
  lastFlowEventAtom,
  chatSelectedObjectAtom,
  streamingTalkAtom,
  streamingThoughtAtom,
  chatRefsAtom,
} from "../store/session";
import { objectsAtom } from "../store/objects";
import { fetchSessions, fetchFlow, talkTo, resumeFlow, pauseObject } from "../api/client";
import { ProcessView } from "./ProcessView";
import { ObjectReadmeView } from "./ObjectReadmeView";
import { DataTab } from "./DataTab";
import { SharedTab } from "./SharedTab";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { ActionCard, TalkCard } from "../components/ui/ActionCard";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import { cn } from "../lib/utils";
import { Send, AtSign, X, ChevronUp, ChevronDown, Loader } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile";
import { WelcomePage } from "./WelcomePage";
import type { FlowData, FlowMessage, Action, ProcessNode, TimelineEntry, ActionDisplayMode } from "../api/types";

export function ChatPage() {
  const [, setSessions] = useAtom(userSessionsAtom);
  const [activeId, setActiveId] = useAtom(activeSessionIdAtom);
  const [activeFlow, setActiveFlow] = useAtom(activeSessionFlowAtom);
  const lastEvent = useAtomValue(lastFlowEventAtom);
  const objects = useAtomValue(objectsAtom);
  const isMobile = useIsMobile();
  const [, setStreamingTalk] = useAtom(streamingTalkAtom);
  const [chatRefs, setChatRefs] = useAtom(chatRefsAtom);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState<string | null>("supervisor");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mentionRef = useRef<HTMLDivElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 从当前会话推断 target（排除 user 自身） */
  useEffect(() => {
    if (activeFlow?.stoneName && !target && activeFlow.stoneName !== "user") {
      setTarget(activeFlow.stoneName);
    }
  }, [activeFlow?.stoneName]);

  /* 加载 user sessions */
  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => setSessions([]));
  }, [setSessions]);

  /* 选中会话时加载 Flow 详情 */
  useEffect(() => {
    if (activeId) {
      fetchFlow(activeId).then(setActiveFlow).catch(console.error);
    } else {
      setActiveFlow(null);
    }
  }, [activeId, setActiveFlow]);

  /* 滚动到底部 */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeFlow]);

  /* 点击外部关闭 mention 下拉 */
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

  /* SSE 实时更新 */
  const pendingSendRef = useRef<string | null>(null);

  const debouncedRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      fetchSessions().then(setSessions).catch(console.error);
      if (activeId) {
        fetchFlow(activeId).then((serverFlow) => {
          /* 合并 optimistic message：如果本地有比服务端更新的用户消息，保留它 */
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

  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.type === "flow:start" && pendingSendRef.current) {
      const taskId = lastEvent.taskId;
      pendingSendRef.current = null;
      setActiveId(taskId);
      setSending(false);
      fetchSessions().then(setSessions).catch(console.error);
      return;
    }

    /* flow:message 事件：直接追加消息到 activeFlow，不等 debounced fetchFlow */
    if (lastEvent.type === "flow:message" && activeFlow) {
      const msg = lastEvent.message as FlowMessage;
      setActiveFlow((prev) => {
        if (!prev) return prev;
        /* 避免重复：检查 timestamp + from + content */
        const dup = prev.messages.some(
          (m) => m.timestamp === msg.timestamp && m.from === msg.from && m.content === msg.content,
        );
        if (dup) return prev;
        return { ...prev, messages: [...prev.messages, msg] };
      });
      /* 消息到达后清除流式 talk 状态 */
      setStreamingTalk(null);
    }

    if ("taskId" in lastEvent) debouncedRefresh();
  }, [lastEvent, debouncedRefresh, setActiveId, setSessions]);

  useEffect(() => {
    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, []);

  /* 可选对象列表（排除 user 和 world） */
  const mentionableObjects = objects
    .filter((o) => o.name !== "user" && o.name !== "world")
    .filter((o) => !mentionFilter || o.name.toLowerCase().includes(mentionFilter.toLowerCase()));

  const selectTarget = (name: string) => {
    setTarget(name);
    setMentionOpen(false);
    setMentionFilter("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  /* onRef 回调：添加引用到 chatRefs（去重） */
  const handleRef = useCallback((id: string, objectName: string) => {
    setChatRefs((prev) => {
      if (prev.some((r) => r.id === id)) return prev;
      return [...prev, { id, objectName }];
    });
  }, [setChatRefs]);

  /* 发送消息 */
  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || !target) return;

    /* 将 refs 嵌入消息末尾 */
    const refSuffix = chatRefs.length > 0
      ? "\n" + chatRefs.map((r) => `[ref:${r.id}]`).join("")
      : "";
    const fullMsg = msg + refSuffix;

    setSending(true);
    setInput("");
    setChatRefs([]);

    const resumeFlowId = activeFlow ? activeFlow.taskId : undefined;

    const optimisticMsg: FlowMessage = {
      direction: "out" as const,
      from: "user",
      to: target,
      content: fullMsg,
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
        /* fire-and-forget：不阻塞等待 ThinkLoop 完成，靠 SSE 事件刷新 */
        setSending(false);
        talkTo(target, fullMsg, resumeFlowId).catch(console.error);
      } else {
        pendingSendRef.current = target;
        talkTo(target, fullMsg).catch((e) => {
          console.error(e);
          pendingSendRef.current = null;
          setSending(false);
        });
      }
    } catch (e) {
      console.error(e);
      setSending(false);
    }
  };

  return (
    <div className="relative flex h-full">
      {/* 主聊天区域（始终占满宽度） */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* 聊天记录 / Session 详情 */}
        {activeFlow ? (
          <div className={cn("flex-1 overflow-hidden pt-6", isMobile ? "px-3" : "px-8")}>
            <ChatContent flow={activeFlow} onRef={handleRef} />
          </div>
        ) : (
          <WelcomePage
            onSend={async (t, msg) => {
              setTarget(t);
              setInput(msg);
              setSending(true);
              pendingSendRef.current = t;
              try {
                const result = await talkTo(t, msg);
                /* 直接用返回的 taskId 导航，不依赖 SSE flow:start */
                if (result.taskId) {
                  pendingSendRef.current = null;
                  setActiveId(result.taskId);
                  setSending(false);
                  fetchSessions().then(setSessions).catch(console.error);
                }
              } catch (e) {
                console.error(e);
                setSending(false);
                pendingSendRef.current = null;
              }
            }}
            sending={sending}
          />
        )}

        {/* 浮动输入框 + TODO 面包机 — 绝对定位在底部（仅在有活跃 session 时显示） */}
        {activeFlow && <div className={cn("absolute bottom-0 left-0 right-0 pointer-events-none", isMobile ? "pb-2 px-3 safe-bottom" : "pb-5 px-8")}>
          <div className="max-w-5xl mx-auto relative pointer-events-auto">
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

            {/* TODO 面包机 + 输入框 — 合为一体 */}
            {/* TODO 面包机 — 在输入框之上 */}
            {activeFlow && <TodoToaster flow={activeFlow} />}

            {/* 输入框 */}
            <div className="border border-[var(--border)] rounded-2xl overflow-hidden focus-within:border-[var(--ring)] transition-colors backdrop-blur-md" style={{ backgroundColor: "color-mix(in srgb, var(--card) 70%, transparent)" }}>
              {/* RefTag 列表 */}
              {chatRefs.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap px-4 pt-2.5 pb-1">
                  {chatRefs.map((ref) => (
                    <span
                      key={ref.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent)] text-[10px] font-mono text-[var(--muted-foreground)]"
                    >
                      <ObjectAvatar name={ref.objectName} size="sm" />
                      {ref.id}
                      <button
                        onClick={() => setChatRefs((prev) => prev.filter((r) => r.id !== ref.id))}
                        className="ml-0.5 hover:text-[var(--foreground)] transition-colors"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
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
                onFocus={() => {
                  /* Mobile: 键盘弹出时滚动输入框到可见区域 */
                  if (isMobile) {
                    setTimeout(() => inputRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }), 300);
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
        </div>}
      </div>
    </div>
  );
}

function ChatContent({ flow, onRef }: { flow: FlowData; onRef?: (id: string, objectName: string) => void }) {
  const [tab, setTab] = useState<"messages" | "timeline" | "process" | "readme" | "data" | "shared">("messages");
  const [resuming, setResuming] = useState(false);
  const selectedObject = useAtomValue(chatSelectedObjectAtom);
  const tabContentRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  /* 信息级别配置：每个对象的 action 展示模式 */
  const [objectMode, setObjectMode] = useState<Record<string, ActionDisplayMode>>({});

  /* 流式状态 */
  const streamingTalk = useAtomValue(streamingTalkAtom);
  const streamingThought = useAtomValue(streamingThoughtAtom);

  const pendingOutput = flow.data?._pendingOutput as string | undefined;

  const activeObj = selectedObject;

  /* 切换对象时重置 tab */
  useEffect(() => {
    if (activeObj) setTab("messages");
  }, [activeObj]);

  /* 过滤消息 */
  const allMessages = flow.messages.filter((msg) => {
    const isUser = msg.from === "user" || msg.from === "human";
    if (isUser && msg.to === "user") return false;
    return true;
  });
  const chatMessages = activeObj
    ? allMessages.filter((msg) => msg.from === activeObj || msg.to === activeObj)
    : allMessages;

  /* 获取选中对象的 process */
  const getProcessForObject = (name: string | null) => {
    if (!name) return flow.process;
    if (flow.subFlows) {
      const sf = flow.subFlows.find((s) => s.stoneName === name);
      if (sf) return sf.process;
    }
    return flow.process;
  };
  const activeProcess = getProcessForObject(activeObj);

  /* 当前 flow 的流式 talk — flow running 时直接显示，不严格匹配 taskId
   * 因为 sub-flow 的 taskId 在第一个 stream 事件到达时可能还没同步到前端 */
  const activeStreamingTalk = useMemo(() => {
    if (!streamingTalk) return null;
    if (flow.status !== "running") return null;
    if (activeObj && streamingTalk.from !== activeObj && streamingTalk.target !== activeObj) return null;
    return streamingTalk;
  }, [streamingTalk, activeObj, flow.status]);

  /* 滚动缩放效果 — messages tab 和 timeline 都生效 */
  useEffect(() => {
    const container = tabContentRef.current;
    const isActive = tab === "messages" || !activeObj; /* messages tab 或 All 模式（timeline） */
    if (!container || !isActive) return;

    const updateScale = () => {
      const rect = container.getBoundingClientRect();
      const threshold = 180; /* 缩放过渡区域高度 */
      const triggerLine = rect.top + 60; /* 下边界靠近容器顶部时开始缩放 */
      const items = container.querySelectorAll<HTMLElement>("[data-timeline-item]");
      for (const el of items) {
        const elRect = el.getBoundingClientRect();
        const distFromTrigger = elRect.bottom - triggerLine;
        if (distFromTrigger < threshold) {
          const t = Math.max(0, distFromTrigger / threshold); /* 0 = 完全离开, 1 = 完全可见 */
          const scale = 0.97 + 0.03 * t;
          const opacity = 0.2 + 0.8 * t;
          const translateY = Math.min(90, (1 - t) * 120); /* 向下平移，营造叠放效果 */
          el.style.transform = `scale(${scale}) translateY(${translateY}px)`;
          el.style.opacity = `${opacity}`;
        } else {
          el.style.transform = "";
          el.style.opacity = "";
        }
      }
    };

    container.addEventListener("scroll", updateScale, { passive: true });
    updateScale();
    return () => container.removeEventListener("scroll", updateScale);
  }, [tab, activeObj, chatMessages.length]);

  const handleResume = async () => {
    setResuming(true);
    try {
      await resumeFlow(flow.stoneName, flow.taskId);
    } catch (e) {
      console.error(e);
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 暂停状态 */}
      {flow.status === "pausing" && pendingOutput && (
          <div className="mb-4 panel-decorated p-3 flex items-center justify-between shrink-0">
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium">Flow paused</span>
              <pre className="text-xs font-mono text-[var(--muted-foreground)] mt-1 truncate">{pendingOutput.slice(0, 100)}...</pre>
            </div>
            <button
              onClick={handleResume}
              disabled={resuming}
              className="ml-3 px-3 py-1.5 text-xs rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50 shrink-0"
            >
              {resuming ? "Resuming..." : "Resume"}
            </button>
          </div>
        )}

        {/* Tab bar — 仅选中对象时显示 */}
        {activeObj && (
          <div className="flex items-center gap-0 mb-0 border-b border-[var(--border)] shrink-0">
            {(["messages", "process", "readme", "data", "shared"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-3 pb-2.5 text-xs transition-colors relative capitalize",
                  tab === t ? "text-[var(--foreground)] font-medium" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                )}
              >
                {t === "messages" ? `Messages (${chatMessages.length})` : t === "process" ? "Process" : t === "readme" ? "Readme" : t === "data" ? "Data" : "Shared"}
                {tab === t && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--foreground)] rounded-full" />}
              </button>
            ))}
            {/* 暂停/继续 switcher */}
            <PauseSwitcher paused={paused} setPaused={setPaused} activeObj={activeObj} flow={flow} />
          </div>
        )}
        {/* All 模式：暂停按钮独立显示 */}
        {!activeObj && (
          <div className="flex items-center justify-end px-2 pb-2 shrink-0">
            <PauseSwitcher paused={paused} setPaused={setPaused} activeObj={activeObj} flow={flow} />
          </div>
        )}

        {/* Tab 内容（可滚动） */}
        <div ref={tabContentRef} data-tab-content className="flex-1 overflow-auto pt-4 pb-8">
          {!activeObj ? (
            /* All 模式：直接渲染统一时间线 */
            <TimelineView
              flow={flow}
              objectMode={objectMode}
              setObjectMode={setObjectMode}
              streamingThought={streamingThought}
              streamingTalk={activeStreamingTalk}
              onRef={onRef}
            />
          ) : tab === "messages" ? (
            <div className="space-y-4 pt-[30vh] pb-[30vh]">
              {chatMessages.map((msg, i) => (
                <MessageBubble key={i} msg={msg} prevMsg={i > 0 ? chatMessages[i - 1] : undefined} />
              ))}
              {/* 流式 talk 气泡 — 带 loading 图标 */}
              {activeStreamingTalk && (
                <StreamingBubble
                  from={activeStreamingTalk.from}
                  to={activeStreamingTalk.target}
                  content={activeStreamingTalk.content}
                />
              )}
              {/* Thinking 提示 — 当对象正在思考时显示 */}
              {flow.status === "running" && streamingThought && !activeStreamingTalk && (
                <ThinkingIndicator objectName={streamingThought.taskId} content={streamingThought.content} />
              )}
              {/* 状态通知 — 轻量级系统消息，缓解等待焦虑 */}
              {flow.status === "running" && !activeStreamingTalk && !streamingThought && (
                <StatusNotice flow={flow} activeObj={activeObj} />
              )}
              {chatMessages.length === 0 && !activeStreamingTalk && (
                <p className="text-xs text-[var(--muted-foreground)] text-center py-12">No messages yet</p>
              )}
            </div>
          ) : tab === "process" ? (
            <ProcessView process={activeProcess} />
          ) : tab === "readme" ? (
            <ObjectReadmeView objectName={activeObj ?? flow.stoneName} showHero />
          ) : tab === "data" ? (
            <div className="px-6 py-4">
              <DataTab data={flow.data ?? {}} />
            </div>
          ) : tab === "shared" ? (
            <div className="px-2">
              <SharedTab objectName={activeObj ?? flow.stoneName} />
            </div>
          ) : null}
          {/* 底部空白块 — 替代原先 pb-32，为浮动输入框留出空间 */}
          <div className="h-24 shrink-0" />
        </div>
      </div>
  );
}

function MessageBubble({ msg, prevMsg }: { msg: FlowMessage; prevMsg?: FlowMessage }) {
  const isUser = msg.from === "user" || msg.from === "human";
  const sameSender = prevMsg && prevMsg.from === msg.from;

  /* 计算与上一条消息的时间差 */
  const timeDelta = prevMsg ? msg.timestamp - prevMsg.timestamp : 0;
  const showTimeDelta = timeDelta > 2000; /* > 2s 才显示 */
  const formatDelta = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  /* 非用户消息：计算响应耗时（与上一条用户消息的时间差） */
  const responseTime = !isUser && prevMsg && (prevMsg.from === "user" || prevMsg.from === "human")
    ? msg.timestamp - prevMsg.timestamp
    : 0;

  return (
    <div data-timeline-item style={{ transformOrigin: "center top", willChange: "transform, opacity" }}>
      {/* 时间间隔指示器 */}
      {showTimeDelta && (
        <div className="flex items-center justify-center py-1 mb-3">
          <span className="text-[10px] text-[var(--muted-foreground)] opacity-60">
            +{formatDelta(timeDelta)}
          </span>
        </div>
      )}

      <div className={cn("flex", isUser ? "justify-end" : "items-start gap-2.5")}>
        {/* 非用户消息：头像 */}
        {!isUser && !sameSender && (
          <ObjectAvatar name={msg.from} size="md" />
        )}
        {!isUser && sameSender && (
          <span className="w-7 shrink-0" /> /* 占位 */
        )}

        <div className="max-w-[85%] sm:max-w-[75%]">
          <div
            className={cn(
              "text-sm rounded-xl px-4 py-3",
              isUser
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "bg-[var(--muted)]",
            )}
          >
            {!isUser && !sameSender && (
              <p className="text-[11px] mb-1 font-medium">
                <span className="text-[var(--muted-foreground)]">{msg.from}</span>
                <span className="text-[var(--muted-foreground)] opacity-50 mx-1">→</span>
                <span className="text-[var(--muted-foreground)] opacity-70">{msg.to}</span>
              </p>
            )}
            {isUser && (
              <p className="text-[11px] mb-1 opacity-60">
                you → {msg.to}
              </p>
            )}
            <MarkdownContent content={msg.content} invertLinks={isUser} />
          </div>
          {/* 响应耗时 */}
          {responseTime > 500 && (
            <p className="text-[10px] text-[var(--muted-foreground)] opacity-50 mt-1 ml-1">
              responded in {formatDelta(responseTime)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ThinkingIndicator — 替代简单的 "Thinking..."
 *
 * 显示当前 focus 节点标题、已完成 action 数量、实时计时
 */
/**
 * StatusNotice — 轻量级状态通知
 *
 * 替代 ThinkingIndicator，以系统消息的形式展示对象状态变化，缓解等待焦虑。
 */
function StatusNotice({ flow, activeObj }: { flow: FlowData; activeObj: string | null }) {
  /* 收集状态信息 */
  const notices: string[] = [];

  /* sub-flow 状态 */
  if (flow.subFlows) {
    for (const sf of flow.subFlows) {
      if (activeObj && sf.stoneName !== activeObj) continue;
      if (sf.status === "running") {
        /* 检查 todo */
        const currentTodo = sf.process?.todo?.[0];
        if (currentTodo) {
          notices.push(`${sf.stoneName} is working on: ${currentTodo.title}`);
        } else {
          notices.push(`${sf.stoneName} is thinking...`);
        }
      }
    }
  }

  if (notices.length === 0) {
    /* 没有 sub-flow 信息时，显示 main flow 状态 */
    const name = activeObj ?? flow.stoneName;
    notices.push(`${name} is thinking...`);
  }

  return (
    <div className="flex justify-center py-2">
      <div className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)] opacity-70">
        <Loader className="w-3 h-3 animate-spin shrink-0" />
        <span>{notices[0]}</span>
      </div>
    </div>
  );
}

/**
 * StreamingBubble — 流式 talk 消息气泡
 *
 * 实时显示正在输出的消息内容，带闪烁光标动画。
 */
function StreamingBubble({ from, to, content }: { from: string; to: string; content: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /* 逐字平滑输出：displayedLen 追赶 content.length */
  const [displayedLen, setDisplayedLen] = useState(0);
  const targetLenRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);

  targetLenRef.current = content.length;

  useEffect(() => {
    /* 每帧追赶：每 15ms 输出一个字符，积攒多了就加速追赶 */
    const step = (now: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = now;
      const delta = now - lastTimeRef.current;
      const gap = targetLenRef.current - displayedLen;
      if (gap > 0) {
        /* 根据积压量动态调速：积压越多越快 */
        const speed = Math.max(1, Math.floor(gap / 10));
        const charsToAdd = Math.min(gap, Math.max(speed, Math.floor(delta / 15)));
        setDisplayedLen((prev) => Math.min(prev + charsToAdd, targetLenRef.current));
        lastTimeRef.current = now;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [displayedLen]);

  const displayed = content.slice(0, displayedLen);

  /* 内容更新时自动滚动到底部 */
  useEffect(() => {
    const el = scrollRef.current?.closest("[data-tab-content]") as HTMLElement | null;
    if (el) el.scrollTop = el.scrollHeight;
  }, [displayed]);

  return (
    <div data-timeline-item style={{ transformOrigin: "center top" }}>
      <div className="flex items-start gap-2.5">
        <ObjectAvatar name={from} size="md" />
        <div className="max-w-[85%] sm:max-w-[75%]">
          <div
            ref={scrollRef}
            className="text-sm rounded-xl px-4 py-3 bg-[var(--muted)]"
          >
            <p className="text-[11px] mb-1 font-medium">
              <span className="text-[var(--muted-foreground)]">{from}</span>
              <span className="text-[var(--muted-foreground)] opacity-50 mx-1">&rarr;</span>
              <span className="text-[var(--muted-foreground)] opacity-70">{to}</span>
            </p>
            {displayed ? (
              <MarkdownContent content={displayed} />
            ) : (
              <span className="text-[var(--muted-foreground)] text-xs">...</span>
            )}
            {/* loading 图标 */}
            <Loader className="inline-block w-3 h-3 text-[var(--muted-foreground)] ml-1.5 align-middle animate-spin" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 统一时间线相关 ── */

/** 递归收集节点树中所有 actions */
function collectAllActionsFromTree(node: ProcessNode): Action[] {
  const result: Action[] = [...node.actions];
  for (const child of node.children) {
    result.push(...collectAllActionsFromTree(child));
  }
  return result;
}

/** 获取时间线条目的 timestamp */
function getEntryTimestamp(entry: TimelineEntry): number {
  if (entry.kind === "message") return entry.data.timestamp;
  if (entry.kind === "action") return entry.data.timestamp;
  return Date.now();
}

/** 构建统一时间线 */
function buildTimeline(flow: FlowData, objectMode: Record<string, ActionDisplayMode>): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  /* 所有 messages（排除 user→user） */
  for (const msg of flow.messages) {
    const isUser = msg.from === "user" || msg.from === "human";
    if (isUser && msg.to === "user") continue;
    entries.push({ kind: "message", data: msg, objectName: msg.from });
  }

  /* 所有 subFlows 的 actions */
  if (flow.subFlows) {
    for (const sf of flow.subFlows) {
      const mode = objectMode[sf.stoneName] ?? "compact";
      if (mode === "hidden") continue;
      if (sf.process?.root) {
        const actions = collectAllActionsFromTree(sf.process.root);
        for (const action of actions) {
          entries.push({ kind: "action", data: action, objectName: sf.stoneName });
        }
      }
    }
  }

  /* main flow 的 actions（如果有） */
  if (flow.process?.root) {
    const mode = objectMode[flow.stoneName] ?? "compact";
    if (mode !== "hidden") {
      const actions = collectAllActionsFromTree(flow.process.root);
      for (const action of actions) {
        entries.push({ kind: "action", data: action, objectName: flow.stoneName });
      }
    }
  }

  entries.sort((a, b) => getEntryTimestamp(a) - getEntryTimestamp(b));
  return entries;
}

/** 收集时间线中涉及的所有对象名 */
function collectParticipants(flow: FlowData): string[] {
  const names = new Set<string>();
  if (flow.subFlows) {
    for (const sf of flow.subFlows) names.add(sf.stoneName);
  }
  if (flow.process?.root) names.add(flow.stoneName);
  /* 排除 user */
  names.delete("user");
  names.delete("human");
  return Array.from(names);
}

const ACTION_TYPE_ICON: Record<string, string> = {
  thought: "💭",
  program: "⚙️",
  inject: "💉",
  message_in: "📩",
  message_out: "📤",
  pause: "⏸",
};

/** ConfigBar — 对象 chips，点击切换 full/compact/hidden */
function ConfigBar({
  participants,
  objectMode,
  setObjectMode,
}: {
  participants: string[];
  objectMode: Record<string, ActionDisplayMode>;
  setObjectMode: React.Dispatch<React.SetStateAction<Record<string, ActionDisplayMode>>>;
}) {
  if (participants.length === 0) return null;

  const cycleMode = (name: string) => {
    setObjectMode((prev) => {
      const current = prev[name] ?? "compact";
      const next: ActionDisplayMode =
        current === "compact" ? "full" : current === "full" ? "hidden" : "compact";
      return { ...prev, [name]: next };
    });
  };

  return (
    <div className="flex items-center gap-1.5 px-2 pb-3 flex-wrap">
      <span className="text-[10px] text-[var(--muted-foreground)] mr-1">Actions:</span>
      {participants.map((name) => {
        const mode = objectMode[name] ?? "compact";
        return (
          <button
            key={name}
            onClick={() => cycleMode(name)}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] transition-colors border",
              mode === "full"
                ? "border-[var(--foreground)] text-[var(--foreground)] bg-[var(--accent)]"
                : mode === "compact"
                  ? "border-[var(--border)] text-[var(--muted-foreground)] bg-transparent"
                  : "border-[var(--border)] text-[var(--muted-foreground)] opacity-40 line-through bg-transparent",
            )}
            title={`${name}: ${mode} (click to cycle)`}
          >
            <ObjectAvatar name={name} size="sm" />
            <span>{name}</span>
            <span className="opacity-60">{mode === "full" ? "▣" : mode === "compact" ? "▤" : "▢"}</span>
          </button>
        );
      })}
    </div>
  );
}

/** CompactAction — 单行缩略 action */
function CompactAction({ action, objectName }: { action: Action; objectName: string }) {
  const icon = ACTION_TYPE_ICON[action.type] ?? "•";
  const preview = action.content.replace(/\n/g, " ").slice(0, 80);

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-[var(--muted-foreground)] hover:bg-[var(--accent)]/30 rounded transition-colors">
      <ObjectAvatar name={objectName} size="sm" />
      <span className="shrink-0">{icon}</span>
      <span className="font-mono text-[10px] shrink-0">[{action.type}]</span>
      <span className="truncate opacity-70">{preview}</span>
      <span className="ml-auto text-[10px] shrink-0 opacity-50">
        {new Date(action.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
    </div>
  );
}

/** ThinkingIndicator — 对象正在思考的实时提示 */
function ThinkingIndicator({ content }: { objectName?: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = content.replace(/\n/g, " ").slice(-120);

  return (
    <div className="flex justify-center py-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-2 text-[11px] text-[var(--muted-foreground)] max-w-[85%] hover:bg-[var(--accent)]/30 rounded-lg px-3 py-2 transition-colors"
      >
        <Loader className="w-3 h-3 animate-spin shrink-0 mt-0.5" />
        <div className="text-left min-w-0">
          <span className="font-medium">thinking...</span>
          {expanded ? (
            <p className="mt-1 text-[10px] opacity-70 whitespace-pre-wrap break-words">{content.slice(-500)}</p>
          ) : (
            <p className="mt-0.5 text-[10px] opacity-50 truncate">{preview}</p>
          )}
        </div>
      </button>
    </div>
  );
}

/** FullActionCard — 完整 action 卡片（使用共享 ActionCard 组件） */
function FullActionCard({ action, objectName, onRef }: { action: Action; objectName: string; onRef?: (id: string, objectName: string) => void }) {
  return <div className="px-1"><ActionCard action={action} objectName={objectName} maxHeight={200} onRef={onRef} /></div>;
}

/** TimelineView — 统一时间线视图 */
function TimelineView({
  flow,
  objectMode,
  setObjectMode,
  streamingThought,
  streamingTalk,
  onRef,
}: {
  flow: FlowData;
  objectMode: Record<string, ActionDisplayMode>;
  setObjectMode: React.Dispatch<React.SetStateAction<Record<string, ActionDisplayMode>>>;
  streamingThought: { taskId: string; content: string } | null;
  streamingTalk: { taskId: string; target: string; from: string; content: string } | null;
  onRef?: (id: string, objectName: string) => void;
}) {
  const participants = useMemo(() => collectParticipants(flow), [flow]);
  const timeline = useMemo(() => buildTimeline(flow, objectMode), [flow, objectMode]);

  return (
    <div>
      <ConfigBar participants={participants} objectMode={objectMode} setObjectMode={setObjectMode} />
      <div className="space-y-3 pt-[30vh] pb-[30vh]">
        {timeline.map((entry, i) => {
          /* 前后类型切换时增加间距 */
          const prevKind = i > 0 ? timeline[i - 1]?.kind : undefined;
          const kindChanged = prevKind && prevKind !== entry.kind;
          const baseStyle = { transformOrigin: "center top" as const, willChange: "transform, opacity" as const };

          if (entry.kind === "message") {
            return <div key={`msg-${i}`} data-timeline-item className={kindChanged ? "pt-4" : ""} style={baseStyle}><TalkCard msg={entry.data} onRef={onRef} /></div>;
          }
          if (entry.kind === "action") {
            const mode = objectMode[entry.objectName] ?? "compact";
            if (mode === "full") {
              return <div key={`act-${i}`} data-timeline-item className={kindChanged ? "pt-4" : ""} style={baseStyle}><FullActionCard action={entry.data} objectName={entry.objectName} onRef={onRef} /></div>;
            }
            return <div key={`act-${i}`} data-timeline-item className={kindChanged ? "pt-4" : ""} style={baseStyle}><CompactAction action={entry.data} objectName={entry.objectName} /></div>;
          }
          return null;
        })}
        {/* 流式 talk */}
        {streamingTalk && (
          <StreamingBubble from={streamingTalk.from} to={streamingTalk.target} content={streamingTalk.content} />
        )}
        {/* Thinking 提示 */}
        {flow.status === "running" && streamingThought && !streamingTalk && (
          <ThinkingIndicator objectName={streamingThought.taskId} content={streamingThought.content} />
        )}
        {/* 兜底状态 */}
        {flow.status === "running" && !streamingThought && !streamingTalk && (
          <div className="flex justify-center py-2">
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)] opacity-70">
              <Loader className="w-3 h-3 animate-spin" />
              <span>processing...</span>
            </div>
          </div>
        )}
        {timeline.length === 0 && flow.status !== "running" && (
          <p className="text-xs text-[var(--muted-foreground)] text-center py-12">No activity yet</p>
        )}
      </div>
    </div>
  );
}

/** PauseSwitcher — 暂停/继续 toggle */
function PauseSwitcher({
  paused, setPaused, activeObj, flow,
}: {
  paused: boolean;
  setPaused: (v: boolean) => void;
  activeObj: string | null;
  flow: FlowData;
}) {
  return (
    <button
      onClick={async () => {
        const objName = activeObj ?? flow.stoneName;
        if (paused) {
          await resumeFlow(objName, flow.taskId).catch(console.error);
          setPaused(false);
        } else {
          await pauseObject(objName).catch(console.error);
          setPaused(true);
        }
      }}
      title={paused ? "继续执行" : "暂停对象执行"}
      className={cn(
        "ml-auto mr-2 flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] transition-colors",
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
      <span>{paused ? "paused now" : "click to pause"}</span>
    </button>
  );
}

/** 收集所有 sub-flow 的 todo 项 */
function collectTodos(flow: FlowData): { objectName: string; todos: import("../api/types").TodoItem[] }[] {
  const result: { objectName: string; todos: import("../api/types").TodoItem[] }[] = [];

  /* main flow */
  if (flow.process?.todo && flow.process.todo.length > 0) {
    result.push({ objectName: flow.stoneName, todos: flow.process.todo });
  }

  /* sub flows */
  if (flow.subFlows) {
    for (const sf of flow.subFlows) {
      if (sf.process?.todo && sf.process.todo.length > 0) {
        result.push({ objectName: sf.stoneName, todos: sf.process.todo });
      }
    }
  }

  return result;
}

function TodoToaster({ flow }: { flow: FlowData }) {
  const [expanded, setExpanded] = useState(false);
  const allTodos = collectTodos(flow);

  if (allTodos.length === 0) return null;

  /* 当前步骤：第一个对象的第一个 todo */
  const current = allTodos[0]!;
  const currentStep = current.todos[0]!;
  const totalCount = allTodos.reduce((sum, g) => sum + g.todos.length, 0);

  return (
    <div className="mx-6 mb-0">
      <div
        className="border border-[var(--border)] border-b-0 rounded-t-xl overflow-hidden transition-all duration-200 backdrop-blur-md"
        style={{ backgroundColor: "color-mix(in srgb, var(--accent) 40%, transparent)" }}
      >
        {/* 折叠态：单行当前步骤 */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-4 py-2 text-xs hover:bg-[var(--accent)]/40 transition-colors"
        >
          <span className="text-[var(--warm)] animate-gentle-pulse shrink-0">●</span>
          <ObjectAvatar name={current.objectName} size="sm" />
          <span className="truncate text-[var(--muted-foreground)]">
            <span className="font-medium text-[var(--foreground)]">{currentStep.title}</span>
            {totalCount > 1 && (
              <span className="ml-1.5 opacity-60">+{totalCount - 1} more</span>
            )}
          </span>
          <span className="ml-auto shrink-0 text-[var(--muted-foreground)]">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </span>
        </button>

        {/* 展开态：完整 TODO 列表 */}
        <div
          className="overflow-hidden transition-all duration-200"
          style={{
            maxHeight: expanded ? `${totalCount * 36 + allTodos.length * 28 + 8}px` : "0px",
            opacity: expanded ? 1 : 0,
          }}
        >
          <div className="border-t border-[var(--border)] px-4 py-2 space-y-2">
            {allTodos.map((group) => (
              <div key={group.objectName}>
                <div className="flex items-center gap-1.5 mb-1">
                  <ObjectAvatar name={group.objectName} size="sm" />
                  <span className="text-[10px] font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
                    {group.objectName}
                  </span>
                </div>
                {group.todos.map((item, i) => (
                  <div key={item.nodeId} className="flex items-center gap-2 text-xs py-1 pl-6">
                    <span className={cn(
                      "w-4 text-right shrink-0",
                      i === 0 ? "text-[var(--warm)] font-medium" : "text-[var(--muted-foreground)]",
                    )}>
                      {i === 0 ? "▸" : `${i + 1}.`}
                    </span>
                    <span className={cn("truncate", i === 0 && "font-medium")}>{item.title}</span>
                    <span className="text-[10px] text-[var(--muted-foreground)] ml-auto shrink-0">{item.source}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
