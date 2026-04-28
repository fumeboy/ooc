/**
 * useUserThreads — 聚合 "user 相关线程" 数据
 *
 * 数据源：
 * 1. `GET /api/flows/:sid` 的 subFlows（每个对象的线程树 root 即 user 主动创建）
 * 2. `GET /api/sessions/:sid/user-inbox` 的 inbox 引用（其他对象 talk user 的线程 id + messageId）
 *
 * 聚合输出：
 * - created_by_user: user 主动 talk 某对象产生的根线程列表（每个 subFlow 一条）
 * - talk_to_user: 按对象聚合的"其他对象 talk user"——同一个对象的多条 inbox 合并为一个分组
 *
 * SSE 触发重新拉取：监听 lastFlowEventAtom，debounce 重拉 inbox（subFlows 由 activeSessionFlowAtom 提供，自动随 SSE 更新）
 *
 * @ref docs/工程管理/迭代/all/20260421_feature_user_inbox.md — UserInbox 引用式 API
 * @ref docs/工程管理/迭代/all/20260421_feature_MessageSidebar_threads视图.md — 聚合规则
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import {
  activeSessionIdAtom,
  activeSessionFlowAtom,
  lastFlowEventAtom,
} from "../store/session";
import { getUserInbox, setUserReadObject } from "../api/client";
import type { UserInbox, UserInboxEntry, Action, ProcessNode, SubFlowSummary, FlowStatus } from "../api/types";

/** 单条"user 主动创建"线程 */
export interface CreatedByUserThread {
  /** 线程 id（= subflow.process.root.id） */
  threadId: string;
  /** 所属对象名（= subflow.stoneName） */
  objectName: string;
  /** 线程标题（meta.title） */
  title: string;
  /** 线程状态 */
  status: ProcessNode["status"];
  /** 所属 subflow 的整体状态（用于显示运行中徽标） */
  flowStatus: FlowStatus;
  /** 节点 updated 时间（用于排序） */
  updatedAt: number;
}

/** 某对象下的一条"talk to user"线程 */
export interface TalkToUserThread {
  threadId: string;
  title: string;
  status: ProcessNode["status"];
  /** 该线程在 inbox 中的全部 messageId（可能多条） */
  messageIds: string[];
  /** 最近一条 message_out 的内容（已 strip [talk] → user: 前缀） */
  lastMessage: string;
  /** 最近一条 message 时间 */
  lastMessageAt: number;
  /** 其中未读的 messageId 数量 */
  unreadCount: number;
}

/** 一个对象聚合下的所有 talk_to_user 线程 */
export interface TalkToUserGroup {
  objectName: string;
  threads: TalkToUserThread[];
  /** 该对象所有线程的未读消息合计 */
  unreadCount: number;
  /** 该对象最新一条 message 的内容（用于卡片缩略） */
  lastMessage: string;
  /** 该对象最新一条 message 的时间戳（用于排序） */
  lastMessageAt: number;
}

export interface UserThreadsData {
  created_by_user: CreatedByUserThread[];
  talk_to_user: TalkToUserGroup[];
  /** 全部未读 messageId 列表（便于 Header 红点判断 + mark-as-read） */
  allUnreadMessageIds: string[];
  /** inbox 原始条目（调试用） */
  rawInbox: UserInboxEntry[];
  /** 服务端下发的 read-state（objectName → lastReadTimestamp） */
  readState: Record<string, number>;
}

/** 从 inbox 引用 + subFlows 反查单条消息的 content（message_out action.id === messageId） */
function findActionInProcess(root: ProcessNode | undefined, actionId: string): Action | null {
  if (!root) return null;
  const walk = (node: ProcessNode): Action | null => {
    for (const a of node.events ?? []) {
      if (a.id === actionId) return a;
    }
    for (const child of node.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}

/** 在整个 subflow 里找 thread 节点（node.id === threadId） */
function findNodeInSubFlow(
  subFlow: SubFlowSummary | undefined,
  threadId: string,
): ProcessNode | null {
  if (!subFlow?.process?.root) return null;
  const walk = (node: ProcessNode): ProcessNode | null => {
    if (node.id === threadId) return node;
    for (const child of node.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(subFlow.process.root);
}

/** 跨所有 subFlows 找 thread 所在的 (subFlow, node) */
export function findThreadInAllSubFlows(
  subFlows: SubFlowSummary[] | undefined,
  threadId: string,
): { subFlow: SubFlowSummary; node: ProcessNode } | null {
  if (!subFlows) return null;
  for (const sf of subFlows) {
    const node = findNodeInSubFlow(sf, threadId);
    if (node) return { subFlow: sf, node };
  }
  return null;
}

/** 从 "[talk] → user: <body> [fork:...] [form: form_xxx]" 剥离前缀和尾缀元标记
 *
 * 清理目标（Bruce 首轮 #14）：让 threads 列表的消息缩略显示的是"人话"，
 * 而不是 LLM 视角的 action content 序列化文本。 */
function stripTalkPrefix(content: string): string {
  const m = content.match(/^\[talk\][^:]*:\s*([\s\S]*)$/);
  let body = (m?.[1] ?? content).trim();
  /* 尾部元标记：[fork] / [fork:xxx] / [continue:xxx] / [form: form_xxx]，可能有多个连续 */
  while (true) {
    const stripped = body.replace(/\s*\[(fork|continue|form)(?::?\s*[^\]]+)?\]\s*$/g, "").trim();
    if (stripped === body) break;
    body = stripped;
  }
  return body || content;
}

/** localStorage 已读消息 id 集合（offline fallback——服务端 readState 不可用时使用） */
function readLastReadSet(sessionId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(`ooc:user-inbox:last-read:${sessionId}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

/** 把一批 messageId 加入 localStorage 的已读集合（offline fallback） */
export function markMessagesRead(sessionId: string, messageIds: string[]): void {
  if (typeof window === "undefined" || messageIds.length === 0) return;
  try {
    const set = readLastReadSet(sessionId);
    for (const id of messageIds) set.add(id);
    window.localStorage.setItem(
      `ooc:user-inbox:last-read:${sessionId}`,
      JSON.stringify([...set]),
    );
  } catch {
    /* ignore */
  }
}

/**
 * 标记某对象线程的最新消息为已读：
 * - 调用 `POST /user-read-state`（后端权威记录）
 * - 失败时写 localStorage 兜底（下次渲染会读到）
 *
 * @param sessionId - session
 * @param objectName - 目标对象名
 * @param timestamp - 已读到的消息 timestamp
 * @param fallbackMessageIds - 可选，失败兜底时要 localStorage.set 的 message id 列表
 */
export async function markObjectRead(
  sessionId: string,
  objectName: string,
  timestamp: number,
  fallbackMessageIds?: string[],
): Promise<void> {
  try {
    await setUserReadObject(sessionId, objectName, timestamp);
  } catch {
    /* 服务端失败，写 localStorage 兜底 */
    if (fallbackMessageIds && fallbackMessageIds.length > 0) {
      markMessagesRead(sessionId, fallbackMessageIds);
    }
  }
}

/**
 * 聚合 hook：返回 user 相关线程数据
 *
 * SSE 刷新策略：lastFlowEventAtom 变化 → debounce 300ms → 重拉 inbox
 */
export function useUserThreads(): UserThreadsData & { refresh: () => void } {
  const sessionId = useAtomValue(activeSessionIdAtom);
  const activeFlow = useAtomValue(activeSessionFlowAtom);
  const lastEvent = useAtomValue(lastFlowEventAtom);

  const [inbox, setInbox] = useState<UserInboxEntry[]>([]);
  /** 服务端 read-state（unread 判定权威）——失败时保持上次值，渲染回退到 localStorage */
  const [readState, setReadState] = useState<Record<string, number>>({});
  const [readStateLoaded, setReadStateLoaded] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 拉取 inbox + readState */
  const refresh = useCallback(() => {
    if (!sessionId) {
      setInbox([]);
      setReadState({});
      setReadStateLoaded(false);
      return;
    }
    getUserInbox(sessionId)
      .then((data: UserInbox) => {
        setInbox(data.inbox ?? []);
        setReadState(data.readState?.lastReadTimestampByObject ?? {});
        setReadStateLoaded(true);
      })
      .catch(() => {
        setInbox([]);
        setReadStateLoaded(false);
      });
  }, [sessionId]);

  /** 初次 + sessionId 变化 */
  useEffect(() => {
    refresh();
  }, [refresh]);

  /** SSE 触发 debounced 重拉 */
  useEffect(() => {
    if (!lastEvent) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 300);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [lastEvent, refresh]);

  /** 聚合计算 */
  const data = useMemo<UserThreadsData>(() => {
    const subFlows = activeFlow?.subFlows ?? [];
    /* 未读判定：优先服务端 readState（timestamp 比较），失败回退 localStorage（messageId 集合） */
    const lastReadSet = readStateLoaded ? null : (sessionId ? readLastReadSet(sessionId) : new Set<string>());

    /* created_by_user：每个 subFlow 的 root 节点 */
    const created_by_user: CreatedByUserThread[] = subFlows.map((sf) => ({
      threadId: sf.process.root.id,
      objectName: sf.stoneName,
      title: sf.process.root.title || "(未命名)",
      status: sf.process.root.status,
      flowStatus: sf.status,
      updatedAt: (sf.process.root.locals as any)?._updatedAt ?? 0,
    })).sort((a, b) => b.updatedAt - a.updatedAt);

    /* talk_to_user：按 threadId 聚合 inbox → 按 object 聚合 */
    const byThread = new Map<
      string,
      {
        objectName: string;
        node: ProcessNode;
        messageIds: string[];
        messageContents: { id: string; content: string; ts: number }[];
        unreadIds: string[];
      }
    >();

    for (const entry of inbox) {
      const found = findThreadInAllSubFlows(subFlows, entry.threadId);
      if (!found) continue;  // 线程已被清理或数据不齐，跳过
      let slot = byThread.get(entry.threadId);
      if (!slot) {
        slot = {
          objectName: found.subFlow.stoneName,
          node: found.node,
          messageIds: [],
          messageContents: [],
          unreadIds: [],
        };
        byThread.set(entry.threadId, slot);
      }
      slot.messageIds.push(entry.messageId);
      const action = findActionInProcess(found.subFlow.process.root, entry.messageId);
      const actionTs = action?.timestamp ?? 0;
      if (action) {
        slot.messageContents.push({
          id: entry.messageId,
          content: stripTalkPrefix(action.content ?? ""),
          ts: actionTs,
        });
      }
      /* 未读判定 */
      const isUnread = readStateLoaded
        ? actionTs > (readState[slot.objectName] ?? 0)
        : !(lastReadSet!.has(entry.messageId));
      if (isUnread) slot.unreadIds.push(entry.messageId);
    }

    const byObject = new Map<string, TalkToUserThread[]>();
    for (const slot of byThread.values()) {
      slot.messageContents.sort((a, b) => b.ts - a.ts);
      const last = slot.messageContents[0];
      const thread: TalkToUserThread = {
        threadId: slot.node.id,
        title: slot.node.title || "(未命名)",
        status: slot.node.status,
        messageIds: slot.messageIds,
        lastMessage: last?.content ?? "",
        lastMessageAt: last?.ts ?? 0,
        unreadCount: slot.unreadIds.length,
      };
      const list = byObject.get(slot.objectName) ?? [];
      list.push(thread);
      byObject.set(slot.objectName, list);
    }

    const talk_to_user: TalkToUserGroup[] = [...byObject.entries()].map(([objectName, threads]) => {
      threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      const unreadCount = threads.reduce((s, t) => s + t.unreadCount, 0);
      const top = threads[0];
      return {
        objectName,
        threads,
        unreadCount,
        lastMessage: top?.lastMessage ?? "",
        lastMessageAt: top?.lastMessageAt ?? 0,
      };
    }).sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    /* allUnreadMessageIds：所有 byThread slot 的 unread 合并 */
    const allUnreadMessageIds: string[] = [];
    for (const slot of byThread.values()) allUnreadMessageIds.push(...slot.unreadIds);

    return {
      created_by_user,
      talk_to_user,
      allUnreadMessageIds,
      rawInbox: inbox,
      readState,
    };
  }, [activeFlow, inbox, sessionId, readState, readStateLoaded]);

  return { ...data, refresh };
}
