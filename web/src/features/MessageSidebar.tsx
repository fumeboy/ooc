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
  messageSidebarViewAtom,
  currentThreadIdAtom,
} from "../store/session";
import { talkTo, fetchFlow, fetchSessions, fetchObjects, pauseObject, resumeFlow } from "../api/client";
import { userSessionsAtom } from "../store/session";
import { ObjectAvatar } from "../components/ui/ObjectAvatar";
import { TuiAction, TuiTalk, TuiUserMessage, TuiStreamingBlock } from "../components/ui/TuiBlock";
import { TuiTalkForm } from "../components/ui/TuiTalkForm";
import { cn } from "../lib/utils";
import { Send, Maximize2, Minimize2, X, ChevronUp, ChevronDown, MessageSquare } from "lucide-react";
import type { FlowMessage, Action, FormResponse, TalkFormPayload } from "../api/types";
import { ProgressIndicator } from "../components/ProgressIndicator";
import { MessageSidebarThreadsList } from "./MessageSidebarThreadsList";
import { useUserThreads, findThreadInAllSubFlows, markMessagesRead, markObjectRead } from "../hooks/useUserThreads";

const DEFAULT_TARGET = "supervisor";

/** Timeline 条目类型（message / action 合并排序） */
type Entry =
  | { kind: "message"; data: FlowMessage }
  | { kind: "action"; data: Action & { _origIndex?: number } };

export function MessageSidebar() {
  const [sidebarMode, setSidebarMode] = useAtom(messageSidebarModeAtom);
  const [sidebarView, setSidebarView] = useAtom(messageSidebarViewAtom);
  const [currentThreadId, setCurrentThreadId] = useAtom(currentThreadIdAtom);
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

  /* 定位 currentThreadId 对应的 thread 节点（跨所有 subFlows 查找） */
  const currentThreadLocation = useMemo(() => {
    if (!currentThreadId || !activeFlow?.subFlows) return null;
    return findThreadInAllSubFlows(activeFlow.subFlows, currentThreadId);
  }, [currentThreadId, activeFlow]);

  /** 当前 Body 展示的线程所属对象名（TuiAction 渲染头像等用） */
  const currentObjectName = currentThreadLocation?.subFlow.stoneName ?? DEFAULT_TARGET;

  /* 构建 timeline：只取 currentThreadId 所在节点的 actions + 对应 messages（过滤到相关对象） */
  const { timeline, formByContent, formById } = useMemo(() => {
    if (!activeFlow || !currentThreadLocation) return {
      timeline: [] as Entry[],
      formByContent: new Map<string, { form: TalkFormPayload; messageId: string | undefined }>(),
      formById: new Map<string, { form: TalkFormPayload; messageId: string | undefined }>(),
    };

    const { node, subFlow } = currentThreadLocation;

    /* messages：只保留与当前 thread 所属对象相关（from/to 含该对象或 user） */
    const objName = subFlow.stoneName;
    const msgs = activeFlow.messages.filter((msg) => {
      if ((msg.from === "user" || msg.from === "human") && msg.to === "user") return false;
      const involvesObj = msg.from === objName || msg.to === objName;
      const involvesUser = msg.from === "user" || msg.from === "human" || msg.to === "user";
      return involvesObj && involvesUser;
    });

    /* 从当前节点 actions 里收集 form 信息（message_out action 携带 form 字段）
     *
     * 现在后端已为每条 message_out 生成 action.id（`msg_xxx`），并且 SSE flow:message
     * 事件和 flow.messages 落盘都带同一个 id。前端优先按 id 匹配（稳），
     * fallback 到内容+timestamp 启发式（兼容老数据）。
     */
    const formById = new Map<string, { form: TalkFormPayload; messageId: string | undefined }>();
    const formMap = new Map<string, { form: TalkFormPayload; messageId: string | undefined }>();
    for (const a of node.actions ?? []) {
      if (a.type === "message_out" && a.form) {
        /* 按 id 精确匹配（最稳） */
        if (a.id) {
          formById.set(a.id, { form: a.form, messageId: a.id });
        }
        /* 同步填 content+timestamp map，老 FlowMessage 没 id 时兜底 */
        const bodyMatch = a.content.match(/^\[talk\][^:]*:\s*([\s\S]*?)(?:\s*\[form:[^\]]+\])?$/);
        const body = (bodyMatch?.[1] ?? a.content).trim();
        formMap.set(`${body.slice(0, 200)}|${a.timestamp ?? 0}`, { form: a.form, messageId: a.id });
      }
    }

    /* actions：只取当前节点自身的 actions（不递归子节点——子线程有自己的 Body） */
    const actions = (node.actions ?? [])
      .map((a, i) => ({ ...a, _origIndex: i }))
      .filter((a) => a.type !== "message_in" && a.type !== "message_out" && a.type !== "thread_return");

    /* 合并并按时间排序 */
    const entries: Entry[] = [
      ...msgs.map((m): Entry => ({ kind: "message", data: m })),
      ...actions.map((a): Entry => ({ kind: "action", data: a })),
    ].sort((a, b) => {
      const ta = a.data.timestamp ?? 0;
      const tb = b.data.timestamp ?? 0;
      if (ta !== tb) return ta - tb;
      if (a.kind === "action" && b.kind === "action") {
        return (a.data._origIndex ?? 0) - (b.data._origIndex ?? 0);
      }
      return 0;
    });

    return { timeline: entries, formByContent: formMap, formById };
  }, [activeFlow, currentThreadLocation]);

  /* 已提交的 formId 集合（localStorage 持久化，刷新后不重复显示 picker） */
  const [submittedFormIds, setSubmittedFormIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined" || !activeId) return new Set();
    try {
      const raw = window.localStorage.getItem(`ooc:talk-form:submitted:${activeId}`);
      return new Set(raw ? JSON.parse(raw) as string[] : []);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (!activeId) { setSubmittedFormIds(new Set()); return; }
    try {
      const raw = window.localStorage.getItem(`ooc:talk-form:submitted:${activeId}`);
      setSubmittedFormIds(new Set(raw ? JSON.parse(raw) as string[] : []));
    } catch {
      setSubmittedFormIds(new Set());
    }
  }, [activeId]);

  /* 匹配 FlowMessage 到 form
   *
   * 三级匹配：
   * 1. msg.id 精确匹配（后端为 message_out 生成的 `msg_xxx`，最稳）
   * 2. content + timestamp 精确匹配（兼容没有 id 的老消息 / 某些 SSE 路径）
   * 3. 仅 content 匹配（timestamp 微差兜底）
   */
  const lookupFormForMessage = useCallback((msg: FlowMessage): { form: TalkFormPayload; messageId: string | undefined } | null => {
    if (msg.from === "user" || msg.from === "human") return null;
    if (msg.to !== "user" && msg.to !== "human") return null;
    /* 1. id 精确匹配 */
    if (msg.id) {
      const byId = formById.get(msg.id);
      if (byId) return byId;
    }
    /* 2. content+timestamp 匹配 */
    const key = `${msg.content.slice(0, 200).trim()}|${msg.timestamp ?? 0}`;
    const exact = formByContent.get(key);
    if (exact) return exact;
    /* 3. 仅 content 匹配（兼容 SSE 时间戳微差） */
    for (const [k, v] of formByContent) {
      const [kContent] = k.split("|");
      if (kContent === msg.content.slice(0, 200).trim()) return v;
    }
    return null;
  }, [formByContent, formById]);

  /* formResponse 发送处理 */
  const handleFormSubmit = useCallback(async (targetObject: string, response: FormResponse, displayText: string) => {
    const sid = activeFlow?.sessionId;
    /* 乐观消息：在 Body 本地立即展示用户的 displayText（用户点选项时取 label；写自由文本时就是文字） */
    const optimistic: FlowMessage = {
      direction: "out",
      from: "user",
      to: targetObject,
      content: displayText,
      timestamp: Date.now(),
    };
    if (activeFlow && sid) {
      setActiveFlow({
        ...activeFlow,
        messages: [...activeFlow.messages, optimistic],
      });
    }
    /* 标记 formId 为已提交（避免刷新后 picker 重现） */
    if (activeId) {
      const next = new Set(submittedFormIds);
      next.add(response.formId);
      setSubmittedFormIds(next);
      try {
        window.localStorage.setItem(`ooc:talk-form:submitted:${activeId}`, JSON.stringify([...next]));
      } catch { /* ignore */ }
    }
    /* 调后端（异步；后端会通过 [formResponse] 前缀传给 LLM） */
    await talkTo(targetObject, displayText, sid, response).catch((e) => {
      console.error("form submit error:", e);
      throw e;
    });
  }, [activeFlow, activeId, setActiveFlow, submittedFormIds]);

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
    /* 如果 activeFlow 已经匹配当前 session（乐观更新），不清空 */
    if (!activeFlow || activeFlow.sessionId !== activeId) {
      setActiveFlow(null);
    }
    if (!activeId) return;
    fetchFlow(activeId).then((serverFlow) => {
      setActiveFlow((prev) => {
        if (!prev) return serverFlow;
        /* 合并：保留乐观消息（如果服务端还没有） */
        const serverMsgCount = serverFlow.messages.length;
        const prevMsgCount = prev.messages.length;
        if (prevMsgCount > serverMsgCount) {
          return { ...serverFlow, messages: [...serverFlow.messages, ...prev.messages.slice(serverMsgCount)] };
        }
        return serverFlow;
      });
    }).catch(console.error);
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

  /* user 相关线程聚合（用于 threads list + Header 红点） */
  const userThreads = useUserThreads();

  /* session 切换时重置 currentThreadId（避免保留跨 session 的旧 thread） */
  useEffect(() => {
    setCurrentThreadId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  /* 自动选默认线程：若 currentThreadId 为空且 supervisor 有 root thread，自动选为默认
   * 逻辑：subFlows 里找 stoneName === "supervisor"，取其 process.root.id
   * 若 supervisor 还没起 thread，currentThreadId 保持 null，Body 显示空状态 */
  useEffect(() => {
    if (currentThreadId) return;
    const supervisorSub = activeFlow?.subFlows?.find((sf) => sf.stoneName === DEFAULT_TARGET);
    const rootId = supervisorSub?.process?.root?.id;
    if (rootId) setCurrentThreadId(rootId);
  }, [activeFlow, currentThreadId, setCurrentThreadId]);

  /* 切到某 thread 时，把该线程所属对象 lastReadTimestamp 上报给服务端：
   *   - 时间戳取该 thread 中最大的 inbox 消息 timestamp（从 subFlows 反查 action.timestamp）
   *   - 服务端失败时写 localStorage 兜底（保证离线也有已读记录）
   * 同时兼容读 localStorage 的旧逻辑：对该 thread 的 messageIds 也写进 localStorage */
  useEffect(() => {
    if (!activeId || !currentThreadId) return;
    const inboxForThread = userThreads.rawInbox.filter((e) => e.threadId === currentThreadId);
    if (inboxForThread.length === 0) return;

    /* 反查当前 thread 所属对象 + 该线程最大 message_out timestamp */
    const sfs = activeFlow?.subFlows ?? [];
    const found = findThreadInAllSubFlows(sfs, currentThreadId);
    const objectName = found?.subFlow.stoneName;
    if (!objectName) return;

    let maxTs = 0;
    for (const entry of inboxForThread) {
      const actions = found.node.actions ?? [];
      const act = actions.find((a) => a.id === entry.messageId);
      if (act?.timestamp && act.timestamp > maxTs) maxTs = act.timestamp;
    }
    if (maxTs === 0) return;

    const msgIds = inboxForThread.map((e) => e.messageId);
    /* 异步上报服务端；失败时回退 localStorage */
    void markObjectRead(activeId, objectName, maxTs, msgIds);
    /* 同时写 localStorage——服务端成功时也更新，便于 offline 重载时仍然已读 */
    markMessagesRead(activeId, msgIds);
  }, [activeId, currentThreadId, userThreads.rawInbox, activeFlow]);

  /* 未读角标：排除"当前正在查看的 thread"的消息，避免红点跟着自己跑 */
  const unreadTotal = useMemo(() => {
    if (!userThreads.rawInbox.length) return 0;
    let count = 0;
    for (const entry of userThreads.rawInbox) {
      if (entry.threadId === currentThreadId) continue;
      if (userThreads.allUnreadMessageIds.includes(entry.messageId)) count += 1;
    }
    return count;
  }, [userThreads.rawInbox, userThreads.allUnreadMessageIds, currentThreadId]);
  const hasUnread = unreadTotal > 0;

  return (
    <div className={cn(
      "flex flex-col bg-[var(--panel-bg)] rounded-[var(--panel-radius)] overflow-hidden",
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
          {/* threads 列表切换按钮（带未读 dot 角标） */}
          <button
            onClick={() => setSidebarView(sidebarView === "threads" ? "process" : "threads")}
            className={cn(
              "relative p-1 rounded-lg transition-colors",
              sidebarView === "threads"
                ? "bg-[var(--accent)] text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
            )}
            title={sidebarView === "threads" ? "返回对话" : "查看所有线程"}
          >
            <MessageSquare className="w-4 h-4" />
            {hasUnread && (
              <span
                className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500"
                title={`${unreadTotal} 条未读`}
              />
            )}
          </button>
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

      {/* threads 视图：双栏 list */}
      {sidebarView === "threads" && <MessageSidebarThreadsList />}

      {/* process 视图：原有消息列表区域 */}
      {sidebarView === "process" && (
      <div className="flex-1 flex flex-col relative min-h-0">
        {/* 消息列表 */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-3 space-y-1.5">
        {timeline.length === 0 && !activeStreamingTalk && (
          <p className="text-xs text-[var(--muted-foreground)] text-center py-8 font-mono">
            {currentThreadId
              ? "此线程暂无内容"
              : `向 ${target} 发起对话，输入 @ 切换对象`}
          </p>
        )}
        {timeline.map((entry, i) => {
          if (entry.kind === "message") {
            const msg = entry.data as FlowMessage;
            const isUser = msg.from === "user" || msg.from === "human";
            /* 对象发给 user 的消息：如果对应 message_out action 有 form，渲染 option picker */
            const formInfo = !isUser ? lookupFormForMessage(msg) : null;
            return (
              <div key={`msg-${i}`} ref={(el) => { msgRefs.current[i] = el; }}>
                {isUser
                  ? <TuiUserMessage msg={msg} />
                  : formInfo
                    ? <TuiTalkForm
                        msg={msg}
                        form={formInfo.form}
                        alreadySubmitted={submittedFormIds.has(formInfo.form.formId)}
                        onSubmit={async (response) => {
                          /* displayText：点选项 → 取 label；自由文本 → 用 freeText */
                          let displayText = response.freeText ?? "";
                          if (response.selectedOptionIds.length > 0) {
                            const labels = response.selectedOptionIds.map((id) => {
                              const opt = formInfo.form.options.find((o) => o.id === id);
                              return opt?.label ?? id;
                            });
                            displayText = labels.join("、");
                            if (response.freeText) displayText += `（备注：${response.freeText}）`;
                          }
                          if (!displayText) displayText = "(已跳过)";
                          await handleFormSubmit(msg.from, response, displayText);
                        }}
                      />
                    : <TuiTalk msg={msg} />
                }
              </div>
            );
          }
          if (entry.kind === "action") {
            const a = entry.data as Action;
            return (
              <div key={`act-${i}`} ref={(el) => { msgRefs.current[i] = el; }}>
                <TuiAction
                  action={a}
                  objectName={currentObjectName}
                  loading={activeFlow?.status === "running" && i === timeline.length - 1}
                />
              </div>
            );
          }
          return null;
        })}
        {/* 流式 thought */}
        {streamingThought && activeFlow?.status === "running" && (
          <TuiStreamingBlock type="thinking" content={streamingThought.content} objectName={currentObjectName} />
        )}
        {/* 流式 program */}
        {streamingProgram && activeFlow?.status === "running" && (
          <TuiStreamingBlock type="program" content={streamingProgram.content} objectName={currentObjectName} />
        )}
        {/* 流式 action */}
        {streamingAction && activeFlow?.status === "running" && (
          <TuiStreamingBlock type="action" content={streamingAction.content} objectName={currentObjectName} />
        )}
        {/* 流式 stack_push */}
        {streamingStackPush && activeFlow?.status === "running" && (
          <TuiStreamingBlock
            type="stack_push"
            content={`[${streamingStackPush.opType}.${streamingStackPush.attr}] ${streamingStackPush.content}`}
            objectName={currentObjectName}
          />
        )}
        {/* 流式 stack_pop */}
        {streamingStackPop && activeFlow?.status === "running" && (
          <TuiStreamingBlock
            type="stack_pop"
            content={`[${streamingStackPop.opType}.${streamingStackPop.attr}] ${streamingStackPop.content}`}
            objectName={currentObjectName}
          />
        )}
        {/* 流式 set_plan */}
        {streamingSetPlan && activeFlow?.status === "running" && (
          <TuiStreamingBlock type="set_plan" content={streamingSetPlan.content} objectName={currentObjectName} />
        )}
        {/* 流式 talk */}
        {activeStreamingTalk && (
          <TuiTalk
            msg={{
              direction: "out",
              from: activeStreamingTalk.from,
              to: activeStreamingTalk.target,
              content: activeStreamingTalk.content,
              timestamp: Date.now(),
            }}
            loading
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
      )}

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
