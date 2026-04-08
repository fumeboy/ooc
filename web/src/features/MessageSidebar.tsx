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
  streamingThoughtAtom,
  streamingProgramAtom,
  streamingActionAtom,
  streamingStackPushAtom,
  streamingStackPopAtom,
  streamingSetPlanAtom,
  messageSidebarModeAtom,
} from "../store/session";
import { talkTo, fetchFlow, fetchSessions, fetchObjects, pauseObject, resumeFlow } from "../api/client";
import { userSessionsAtom } from "../store/session";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import { TalkCard, ActionCard } from "../components/ui/ActionCard";
import { cn } from "../lib/utils";
import { Send, Maximize2, Minimize2, X, ChevronUp, ChevronDown } from "lucide-react";
import type { FlowMessage, Action } from "../api/types";
import { ProgressIndicator } from "../components/ProgressIndicator";

const DEFAULT_TARGET = "supervisor";

export function MessageSidebar() {
  const [sidebarMode, setSidebarMode] = useAtom(messageSidebarModeAtom);
  const activeId = useAtomValue(activeSessionIdAtom);
  const [activeFlow, setActiveFlow] = useAtom(activeSessionFlowAtom);
  const lastEvent = useAtomValue(lastFlowEventAtom);
  const streamingTalk = useAtomValue(streamingTalkAtom);
  const streamingThought = useAtomValue(streamingThoughtAtom);
  const streamingProgram = useAtomValue(streamingProgramAtom);
  const streamingAction = useAtomValue(streamingActionAtom);
  const streamingStackPush = useAtomValue(streamingStackPushAtom);
  const streamingStackPop = useAtomValue(streamingStackPopAtom);
  const streamingSetPlan = useAtomValue(streamingSetPlanAtom);
  const [, setSessions] = useAtom(userSessionsAtom);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [paused, setPaused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [currentMsgIdx, setCurrentMsgIdx] = useState(-1);
  const pendingSendRef = useRef<boolean>(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 用户是否主动滚动到非底部位置 */
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  /** 未读消息数量（用户不在底部期间新增的消息数） */
  const [unreadCount, setUnreadCount] = useState(0);

  /** 滚动到顶部前的 timeline 长度，用于计算新增消息数 */
  const lastKnownLengthRef = useRef(0);

  /** 阈值：允许底部有多少像素偏差仍认为在底部 */
  const SCROLL_THRESHOLD = 50;

  /* @对象 自动补全 */
  const [objectNames, setObjectNames] = useState<string[]>([]);
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionRef = useRef<HTMLDivElement>(null);

  /** 检测用户是否在滚动区域底部 */
  const isUserAtBottom = useCallback(() => {
    if (!scrollRef.current) return true;
    const { scrollTop, clientHeight, scrollHeight } = scrollRef.current;
    return scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD;
  }, []);

  /* 加载对象列表（一次性） */
  useEffect(() => {
    fetchObjects()
      .then((objs) => setObjectNames(objs.map((o) => o.name)))
      .catch(console.error);
  }, []);

  /* 从服务端同步 pause 状态 */
  useEffect(() => {
    fetchObjects()
      .then((objs) => {
        const supervisor = objs.find((o) => o.name === "supervisor");
        if (supervisor) setPaused(!!supervisor.paused);
      })
      .catch(console.error);
  }, [activeId]);

  /* 过滤 mention 候选 */
  const mentionCandidates = useMemo(() => {
    if (!showMention) return [];
    const q = mentionQuery.toLowerCase();
    return objectNames
      .filter((name) => name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [showMention, mentionQuery, objectNames]);

  /* 构建 timeline：messages + supervisor actions，按时间排序 */
  const timeline = useMemo(() => {
    if (!activeFlow) return [];

    /* 收集 messages（排除 user→user） */
    const msgs = activeFlow.messages.filter((msg) => {
      if ((msg.from === "user" || msg.from === "human") && msg.to === "user") return false;
      return true;
    });

    /* 收集 supervisor 的 actions（从 subFlows 中提取） */
    const collectActions = (node: any): (Action & { _origIndex: number })[] => {
      const actions: (Action & { _origIndex: number })[] = [];
      let index = 0;
      const walk = (n: any) => {
        for (const a of n.actions ?? []) {
          actions.push({ ...a, _origIndex: index++ });
        }
        for (const child of n.children ?? []) {
          walk(child);
        }
      };
      walk(node);
      return actions;
    };

    const supervisorFlow = (activeFlow as any).subFlows?.find((sf: any) => sf.stoneName === "supervisor");
    const process = supervisorFlow?.process ?? activeFlow.process;
    const allActions = process?.root ? collectActions(process.root) : [];
    /* 过滤掉 message_in/message_out（messages 已包含这些信息） */
    const actions = allActions.filter((a) => a.type !== "message_in" && a.type !== "message_out");

    /* 合并并按时间排序 */
    type Entry = { kind: "message"; data: FlowMessage } | { kind: "action"; data: Action & { _origIndex?: number } };
    const entries: Entry[] = [
      ...msgs.map((m): Entry => ({ kind: "message", data: m })),
      ...actions.map((a): Entry => ({ kind: "action", data: a })),
    ].sort((a, b) => {
      const ta = a.data.timestamp ?? 0;
      const tb = b.data.timestamp ?? 0;
      if (ta !== tb) return ta - tb;
      // 时间戳相同时：
      // - 如果都是 action，按先序遍历的原始顺序排列
      if (a.kind === "action" && b.kind === "action") {
        return (a.data._origIndex ?? 0) - (b.data._origIndex ?? 0);
      }
      return 0;
    });

    return entries;
  }, [activeFlow]);

  /* 监听滚动事件，检测用户是否手动向上滚动 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const atBottom = isUserAtBottom();
      if (atBottom && userScrolledUp) {
        // 用户手动滚回底部，重置状态
        setUserScrolledUp(false);
        setUnreadCount(0);
      } else if (!atBottom && !userScrolledUp) {
        // 用户主动向上滚动
        setUserScrolledUp(true);
        lastKnownLengthRef.current = timeline.length;
      }
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [userScrolledUp, isUserAtBottom, timeline.length]);

  /* 自动滚动逻辑：用户在底部时才自动滚动 */
  useEffect(() => {
    if (!userScrolledUp && scrollRef.current) {
      // 用户在底部时，自动滚动到最新
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    } else if (userScrolledUp) {
      // 用户不在底部时，更新未读计数
      setUnreadCount(timeline.length - lastKnownLengthRef.current);
    }
  }, [timeline.length, streamingTalk, streamingThought, streamingProgram, streamingAction, streamingStackPush, streamingStackPop, streamingSetPlan, userScrolledUp]);

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

  /* activeId 变化时重新加载 flow 数据 */
  useEffect(() => {
    if (!activeId) return;
    fetchFlow(activeId).then(setActiveFlow).catch(console.error);
  }, [activeId]);

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

    if ("sessionId" in lastEvent) debouncedRefresh();
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

  /** 点击新消息按钮，滚动到底部 */
  const handleScrollToNewMessages = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
      // 状态会在 scroll 事件监听中自动重置
    }
  }, []);

  /* 选择 mention 对象 */
  /* 消息导航：上/下切换 */
  const navigateMsg = (direction: "up" | "down") => {
    if (timeline.length === 0) return;
    const next = direction === "up"
      ? Math.max(0, (currentMsgIdx <= 0 ? timeline.length : currentMsgIdx) - 1)
      : Math.min(timeline.length - 1, currentMsgIdx + 1);
    setCurrentMsgIdx(next);
    msgRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

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

    const resumeFlowId = activeFlow ? activeFlow.sessionId : undefined;

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

  /* main 模式：全宽渲染（由 App.tsx 放在主内容区） */
  /* sidebar 模式：固定宽度侧边栏 */
  const isMain = sidebarMode === "main";

  return (
    <div className={cn(
      "flex flex-col bg-[var(--background)]",
      isMain ? "h-full w-full" : "w-[400px] shrink-0",
    )}>
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <ObjectAvatar name={target} size="sm" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">{target}</span>
            {activeId && (
              <span className="text-[9px] text-[var(--muted-foreground)] font-mono leading-none">
                {activeId}
              </span>
            )}
          </div>
          {/* 上/下消息导航 */}
          <div className="flex items-center gap-0.5 ml-1">
            <button
              onClick={() => navigateMsg("up")}
              disabled={timeline.length === 0}
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors disabled:opacity-30"
              title="上一条消息"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => navigateMsg("down")}
              disabled={timeline.length === 0}
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors disabled:opacity-30"
              title="下一条消息"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* 暂停/继续 toggle */}
          {activeFlow && (
            <button
              onClick={async () => {
                const objName = "supervisor";
                if (paused) {
                  await resumeFlow(objName, activeFlow.sessionId).catch(console.error);
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
            onClick={() => setSidebarMode(isMain ? "sidebar" : "main")}
            className="p-1 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
            title={isMain ? "切换到侧边展示" : "切换到主页展示"}
          >
            {isMain ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 迭代进度 */}
      <ProgressIndicator />

      {/* 消息列表区域 */}
      <div className="flex-1 flex flex-col relative min-h-0">
        {/* 消息列表 */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-2 py-3 space-y-3">
        {timeline.length === 0 && !activeStreamingTalk && (
          <p className="text-xs text-[var(--muted-foreground)] text-center py-8">
            输入消息开始对话，输入 @ 选择对象
          </p>
        )}
        {timeline.map((entry, i) => {
          if (entry.kind === "message") {
            const msg = entry.data as FlowMessage;
            const isUser = msg.from === "user" || msg.from === "human";
            return (
              <div key={`msg-${i}`} ref={(el) => { msgRefs.current[i] = el; }}>
                {isUser
                  ? <MessageBubble message={msg} />
                  : <TalkCard msg={msg} maxHeight={0} />
                }
              </div>
            );
          }
          if (entry.kind === "action") {
            const a = entry.data as Action;
            return (
              <div key={`act-${i}`} ref={(el) => { msgRefs.current[i] = el; }}>
                <ActionCard
                  action={a}
                  objectName="supervisor"
                  maxHeight={360}
                  loading={activeFlow?.status === "running" && i === timeline.length - 1}
                />
              </div>
            );
          }
          return null;
        })}
        {/* 流式 thought（正在思考） */}
        {streamingThought && activeFlow?.status === "running" && (
          <ActionCard
            action={{ type: "thought", content: streamingThought.content, timestamp: Date.now() }}
            objectName="supervisor"
            maxHeight={200}
            loading
          />
        )}
        {/* 流式 program（正在输出程序） */}
        {streamingProgram && activeFlow?.status === "running" && (
          <ActionCard
            action={{ type: "program", content: streamingProgram.content, timestamp: Date.now() }}
            objectName="supervisor"
            maxHeight={200}
            loading
          />
        )}
        {/* 流式 action（正在输出 action） */}
        {streamingAction && activeFlow?.status === "running" && (
          <ActionCard
            action={{ type: "action", content: streamingAction.content, timestamp: Date.now() }}
            objectName="supervisor"
            maxHeight={200}
            loading
          />
        )}
        {/* 流式 stack_push（正在推入栈帧） */}
        {streamingStackPush && activeFlow?.status === "running" && (
          <ActionCard
            action={{
              type: "stack_push",
              content: `[${streamingStackPush.opType}.${streamingStackPush.attr}] ${streamingStackPush.content}`,
              timestamp: Date.now(),
            }}
            objectName="supervisor"
            maxHeight={200}
            loading
          />
        )}
        {/* 流式 stack_pop（正在弹出栈帧） */}
        {streamingStackPop && activeFlow?.status === "running" && (
          <ActionCard
            action={{
              type: "stack_pop",
              content: `[${streamingStackPop.opType}.${streamingStackPop.attr}] ${streamingStackPop.content}`,
              timestamp: Date.now(),
            }}
            objectName="supervisor"
            maxHeight={200}
            loading
          />
        )}
        {/* 流式 set_plan（正在设置计划） */}
        {streamingSetPlan && activeFlow?.status === "running" && (
          <ActionCard
            action={{
              type: "set_plan",
              content: streamingSetPlan.content,
              timestamp: Date.now(),
            }}
            objectName="supervisor"
            maxHeight={200}
            loading
          />
        )}
        {/* 流式 talk（正在回复） */}
        {activeStreamingTalk && (
          <TalkCard
            msg={{
              direction: "out",
              from: activeStreamingTalk.from,
              to: activeStreamingTalk.target,
              content: activeStreamingTalk.content,
              timestamp: Date.now(),
            }}
            maxHeight={0}
          />
        )}
        </div>

        {/* 新消息按钮（悬浮在底部中央） */}
        {userScrolledUp && unreadCount > 0 && (
          <button
            onClick={handleScrollToNewMessages}
            className="absolute bottom-2 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-sm shadow-lg hover:opacity-90 transition-opacity z-10"
          >
            ↓ {unreadCount} 条新消息
          </button>
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
