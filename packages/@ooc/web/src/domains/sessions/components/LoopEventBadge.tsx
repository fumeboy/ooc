/**
 * LoopEventBadge — 把 ProcessEvent 中的"关键"事件渲染成一枚 chip。
 *
 * R0c (Agent-loop Visualizer plan §6.4 / event_badge_taxonomy patch):
 * - 严格 type-dispatch 风格: 新增 event 类型时只加 case, 不动调用方。
 * - 非关键事件 (普通 text / reasoning / 普通 tool_use 等) 不进 badge — 减噪音原则。
 * - 颜色与 tooltip 必须有信息密度: tooltip 含触发原因 / windowIds / decided 时间等,
 *   让悬停就能判断"这条 chip 代表了什么", 不用展开 loop 全文。
 *
 * 单测见 LoopTimeline.test.ts (整张 timeline 用例覆盖关键 event 高亮断言)。
 */

import type { ReactNode } from "react";

/**
 * 与 src/thinkable/context/index.ts ProcessEvent 对齐的最小子集 (前端重声明避免 cross-package
 * 导入; 后端 ProcessEvent 是 union, 这里只取我们要分发的 variants)。
 *
 * 用 open shape (含 [k]: unknown 索引签名) 而非严格 discriminated union — 因为前端从 thread.json
 * 拿到的 events 是异构 JSON, 任何 ProcessEvent variants 都可能出现 (text / reasoning /
 * tool_use / tool_use 等), 分类函数自行 narrow。
 */
export interface LoopEvent {
  category?: string;
  kind?: string;
  /** context_compressed */
  windowIds?: string[];
  levelChange?: string;
  reason?: string;
  scope?: string;
  /** events_summary */
  count?: number;
  summary?: string;
  /** permission_ask / permission_denied */
  command?: string;
  argsSummary?: string;
  decided?: { action: "approve" | "reject"; at: number; reason?: string };
  /** tool_runtime.function_call_output */
  toolName?: string;
  ok?: boolean;
  /** 其它 ProcessEvent variants 透传 — 分类函数不消费。 */
  [k: string]: unknown;
}

export interface LoopEventBadgeSpec {
  icon: string;
  /** CSS class suffix; 例如 "blue" → .loop-event-badge-blue */
  color: "blue" | "gray" | "orange" | "green" | "purple" | "yellow" | "red";
  tooltip: string;
  /** 简短文字标签 (icon 旁), 例如 "compress" / "ask"。 */
  label?: string;
}

/**
 * type-dispatch 主表 — 返回 undefined 表示"非关键事件, 不应渲染 badge"。
 *
 * 这是 ProcessEvent → Badge spec 的唯一入口 (LoopEntry / LoopTimeline 都只通过此函数);
 * 加新事件类型时改这里就够了。
 */
export function classifyLoopEvent(event: LoopEvent): LoopEventBadgeSpec | undefined {
  if (!event || typeof event !== "object") return undefined;

  // context_compressed: reason 决定颜色 + icon
  if (event.category === "context_change" && event.kind === "context_compressed") {
    const reason = (event.reason ?? "").toString();
    const windowIds = Array.isArray(event.windowIds) ? event.windowIds : [];
    const wSummary = windowIds.length === 0
      ? "no windows"
      : windowIds.length <= 2
        ? windowIds.join(", ")
        : `${windowIds.slice(0, 2).join(", ")} +${windowIds.length - 2} more`;

    if (reason === "user-compress") {
      return {
        icon: "🗜️",
        color: "blue",
        tooltip: `user-compress: ${wSummary}`,
        label: "compress",
      };
    }
    if (reason === "user-expand") {
      return {
        icon: "↩️",
        color: "green",
        tooltip: `expand: ${windowIds.join(", ") || "(no windows)"}`,
        label: "expand",
      };
    }
    if (reason.startsWith("emergency-guard")) {
      return {
        icon: "⚠️",
        color: "orange",
        tooltip: `emergency guard: ${reason}`,
        label: "guard",
      };
    }
    if (
      reason === "idle-fold" ||
      reason === "age-fold" ||
      reason === "double-fold" ||
      reason === "cascade-fold"
    ) {
      return {
        icon: "🍂",
        color: "gray",
        tooltip: `${reason}: ${windowIds.length} window${windowIds.length === 1 ? "" : "s"} folded`,
        label: reason,
      };
    }
    // unknown reason — still surface as a generic compressed chip
    return {
      icon: "🍂",
      color: "gray",
      tooltip: `context_compressed: ${reason || "(no reason)"} · ${wSummary}`,
      label: "compress",
    };
  }

  if (event.category === "context_change" && event.kind === "events_summary") {
    const count = typeof event.count === "number" ? event.count : 0;
    const raw = (event.summary ?? "").toString();
    const summary = raw.length > 100 ? raw.slice(0, 100) + "…" : raw;
    return {
      icon: "📚",
      color: "purple",
      tooltip: `${count} events folded: ${summary || "(no summary)"}`,
      label: `summary ×${count}`,
    };
  }

  // inject 事件：带 source/errorCode 元数据时显示 badge,便于调试；纯提示文本(无元数据)不渲染
  if (event.category === "context_change" && event.kind === "inject") {
    const ev = event as { text?: string; source?: string; errorCode?: string };
    const hasMeta = Boolean(ev.source || ev.errorCode);
    if (!hasMeta) return undefined;
    const isError = typeof ev.text === "string" && /error|fail|reject|deny|exception|parse/i.test(ev.text);
    const tooltipParts = [
      ev.errorCode ? ev.errorCode : undefined,
      ev.source ? ev.source : undefined,
      typeof ev.text === "string" && ev.text.length > 0
        ? (ev.text.length > 120 ? ev.text.slice(0, 120) + "…" : ev.text)
        : undefined,
    ].filter(Boolean) as string[];
    return {
      icon: isError ? "⚠️" : "ℹ️",
      color: isError ? "red" : "gray",
      tooltip: tooltipParts.join(" · "),
      label: ev.errorCode ? ev.errorCode.slice(0, 20) : "inject",
    };
  }

  if (event.category === "permission" && event.kind === "permission_ask") {
    const command = (event.command ?? "(unknown)").toString();
    if (!event.decided) {
      return {
        icon: "⏸️",
        color: "yellow",
        tooltip: `awaiting approval: ${command}`,
        label: "ask",
      };
    }
    if (event.decided.action === "approve") {
      const ts = new Date(event.decided.at).toLocaleTimeString();
      return {
        icon: "✅",
        color: "green",
        tooltip: `approved at ${ts}: ${command}`,
        label: "approved",
      };
    }
    if (event.decided.action === "reject") {
      const reason = event.decided.reason ?? "(no reason)";
      return {
        icon: "❌",
        color: "red",
        tooltip: `rejected: ${reason}`,
        label: "rejected",
      };
    }
  }

  if (event.category === "permission" && event.kind === "permission_denied") {
    const reason = (event.reason ?? "(no reason)").toString();
    return {
      icon: "🚫",
      color: "red",
      tooltip: `denied: ${reason}`,
      label: "denied",
    };
  }

  if (
    event.category === "tool_runtime" &&
    event.kind === "function_call_output" &&
    event.ok === false
  ) {
    const toolName = (event.toolName ?? "tool").toString();
    return {
      icon: "⚠️",
      color: "orange",
      tooltip: `tool failed: ${toolName}`,
      label: `${toolName} fail`,
    };
  }

  return undefined;
}

export function isKeyEvent(event: LoopEvent): boolean {
  return classifyLoopEvent(event) !== undefined;
}

/**
 * 单个 chip 组件 — 调用者负责传 classify 结果。
 *
 * data-color 属性同步暴露颜色 token, 便于单测断言 (DOM 含 data-color="yellow" 等)。
 */
export function LoopEventBadge({
  event,
  onClick,
}: {
  event: LoopEvent;
  onClick?: (event: LoopEvent) => void;
}): ReactNode {
  const spec = classifyLoopEvent(event);
  if (!spec) return null;

  return (
    <span
      className={`loop-event-badge loop-event-badge-${spec.color}`}
      data-color={spec.color}
      title={spec.tooltip}
      role="button"
      tabIndex={onClick ? 0 : -1}
      onClick={() => onClick?.(event)}
    >
      <span className="loop-event-badge-icon" aria-hidden>
        {spec.icon}
      </span>
      {spec.label && <span className="loop-event-badge-label">{spec.label}</span>}
    </span>
  );
}
