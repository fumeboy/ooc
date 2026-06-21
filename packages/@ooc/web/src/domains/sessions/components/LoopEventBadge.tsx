/**
 * LoopEventBadge — 把 ProcessEvent 中的"关键"事件渲染成一枚 chip。
 *
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
  /** permission_ask / permission_denied */
  method?: string;
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

  // context_compressed (compress v2): summarizer-fork harvest 产物。
  // v2 reason 词表恒为两种（scheduler.ts harvestSummarizerForks）：
  //   - auto-summarized（levelChange=auto-fold）：fork 成功摘要早期 transcript → 折叠
  //   - summarizer-fork-failed…（levelChange=auto-fold-failed）：fork 失败、自动压缩已关
  // （talk-fold 不建——Case E 裁定 summarizer-fold 是自我视角能力——故折叠恒是 self-view transcript，
  //  windowIds 恒空、无 v1 的 user-compress/expand/idle-fold/emergency-guard 等档位。）
  if (event.category === "context_change" && event.kind === "context_compressed") {
    const reason = (event.reason ?? "").toString();
    const levelChange = (event.levelChange ?? "").toString();

    if (reason.startsWith("summarizer-fork-failed") || levelChange === "auto-fold-failed") {
      return {
        icon: "⚠️",
        color: "orange",
        tooltip: `compress failed: ${reason || "summarizer fork failed"}`,
        label: "fold fail",
      };
    }
    return {
      icon: "🍂",
      color: "gray",
      tooltip: `transcript folded (summarizer): ${reason || levelChange || "auto-summarized"}`,
      label: "fold",
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
    const command = (event.method ?? "(unknown)").toString();
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
