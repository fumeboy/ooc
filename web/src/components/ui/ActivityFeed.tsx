/**
 * ActivityFeed — 活动时间线组件
 *
 * 用于展示事件流、变更历史、协作记录等。
 * 支持无限滚动加载更多。
 */

import React, { useRef, useEffect, useCallback } from "react";
import { cn } from "../../lib/utils";
import { ObjectAvatar } from "./ObjectAvatar";
import { Badge } from "./Badge";
import { Loader2 } from "lucide-react";

// 类型定义
export type ActivityEventType =
  | "action"
  | "talk"
  | "state_change"
  | "effect"
  | "custom";

export interface ActivityEvent {
  /** 事件唯一 ID */
  id: string;
  /** 事件类型 */
  type: ActivityEventType;
  /** 时间戳 */
  timestamp: number;
  /** 发起对象名 */
  actor: string;
  /** 事件内容 */
  content: React.ReactNode;

  // talk 类型专用
  /** 接收对象名 */
  recipient?: string;

  // state_change 类型专用
  /** 变更前状态 */
  fromState?: string;
  /** 变更后状态 */
  toState?: string;

  // 自定义图标
  /** 自定义图标 */
  icon?: React.ReactNode;
}

interface ActivityFeedProps {
  /** 事件列表 */
  events: ActivityEvent[];
  /** 加载更多回调 */
  loadMore?: () => void;
  /** 是否还有更多数据 */
  hasMore?: boolean;
  /** 是否正在加载 */
  loading?: boolean;
  /** 事件点击回调 */
  onEventClick?: (event: ActivityEvent) => void;
  /** 最大高度 */
  maxHeight?: string;
  /** 空状态文本 */
  emptyText?: string;
}

export type { ActivityFeedProps };

// 事件类型颜色映射
const EVENT_COLORS: Record<ActivityEventType, string> = {
  action: "bg-blue-500",
  talk: "bg-green-500",
  state_change: "bg-amber-500",
  effect: "bg-purple-500",
  custom: "bg-gray-500",
};

// 事件类型标签映射
const EVENT_LABELS: Record<ActivityEventType, string> = {
  action: "action",
  talk: "talk",
  state_change: "state",
  effect: "effect",
  custom: "custom",
};

/**
 * 格式化相对时间
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;

  // 超过 7 天显示日期
  return new Date(timestamp).toLocaleDateString();
}

/**
 * 单个事件项
 */
interface ActivityItemProps {
  event: ActivityEvent;
  isLast: boolean;
  onClick?: (event: ActivityEvent) => void;
}

function ActivityItem({ event, isLast, onClick }: ActivityItemProps) {
  const { type, timestamp, actor, content, recipient, fromState, toState } = event;
  const dotColor = EVENT_COLORS[type];
  const timeLabel = formatRelativeTime(timestamp);

  return (
    <div className="flex gap-3">
      {/* 时间线 */}
      <div className="flex flex-col items-center">
        {/* 事件点 */}
        <div className={cn("w-3 h-3 rounded-full flex-shrink-0 mt-1.5", dotColor)} />
        {/* 连接线（非最后一个） */}
        {!isLast && (
          <div className="w-px bg-[var(--border)] flex-1 min-h-8" />
        )}
      </div>

      {/* 事件内容 */}
      <div
        className={cn(
          "flex-1 pb-6 min-w-0",
          onClick && "cursor-pointer hover:opacity-80 transition-opacity"
        )}
        onClick={() => onClick?.(event)}
      >
        {/* 头部：时间 + 类型标签 */}
        <div className="flex items-center gap-2 mb-1">
          <ObjectAvatar name={actor} size="sm" />
          <span className="text-xs font-medium text-[var(--foreground)]">{actor}</span>
          {recipient && (
            <>
              <span className="text-[var(--muted-foreground)] text-xs">→</span>
              <ObjectAvatar name={recipient} size="sm" />
              <span className="text-xs font-medium text-[var(--foreground)]">{recipient}</span>
            </>
          )}
          <Badge variant="gray" mono className="text-[10px]">
            {EVENT_LABELS[type]}
          </Badge>
          <span className="text-xs text-[var(--muted-foreground)] ml-auto">{timeLabel}</span>
        </div>

        {/* 状态变更特殊处理 */}
        {type === "state_change" && fromState !== undefined && toState !== undefined && (
          <div className="flex items-center gap-2 mb-1 text-xs">
            <Badge variant="red">{fromState}</Badge>
            <span className="text-[var(--muted-foreground)]">→</span>
            <Badge variant="green">{toState}</Badge>
          </div>
        )}

        {/* 内容 */}
        <div className="text-xs text-[var(--foreground)] leading-relaxed">
          {content}
        </div>
      </div>
    </div>
  );
}

export function ActivityFeed({
  events,
  loadMore,
  hasMore = false,
  loading = false,
  onEventClick,
  maxHeight,
  emptyText = "暂无活动记录",
}: ActivityFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 滚动到加载更多
  const handleScroll = useCallback(() => {
    if (!containerRef.current || !loadMore || !hasMore || loading) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const scrollThreshold = 100;

    if (scrollTop + clientHeight >= scrollHeight - scrollThreshold) {
      loadMore();
    }
  }, [loadMore, hasMore, loading]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !loadMore) return;

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll, loadMore]);

  const containerStyle: React.CSSProperties = {
    maxHeight,
    overflow: maxHeight ? "auto" : undefined,
  };

  // 空状态
  if (events.length === 0) {
    return (
      <div className="border border-[var(--border)] rounded-lg bg-[var(--background)]">
        <div className="py-12 text-center text-[var(--muted-foreground)] text-sm">
          {emptyText}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="border border-[var(--border)] rounded-lg bg-[var(--background)]"
      style={containerStyle}
    >
      <div className="p-4">
        {events.map((event, index) => (
          <ActivityItem
            key={event.id}
            event={event}
            isLast={index === events.length - 1 && !hasMore}
            onClick={onEventClick}
          />
        ))}

        {/* 加载更多指示器 */}
        {hasMore && (
          <div className="flex items-center justify-center py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                加载中...
              </div>
            ) : (
              <button
                onClick={loadMore}
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                加载更多
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
