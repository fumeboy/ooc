/**
 * ContextWindowsPanel — 在 chat panel 内可视化当前 thread 持有的 ContextWindow。
 *
 * spec 依据：docs/superpowers/specs/2026-05-14-web-context-window-alignment-design.md
 *
 * 渲染策略：
 * - 顶层 windows = parentWindowId 为空或等于 "root" 的 window
 * - 每个 window 一行 chip，标题、type、status；点击展开 sub-windows / 详情
 * - command_exec 展开显示 command + accumulatedArgs + result
 * - do 展开显示 targetThreadId + creator 标记
 * - todo 展开显示 content + onCommandPath
 *
 * 不依赖 tui-block 样式，自带最小标记，避免污染 chat-timeline 视觉密度。
 */

import { useState } from "react";
import {
  ChevronRight,
  CircleDot,
  FileCheck,
  FileText,
  Inbox,
  ListChecks,
  Loader2,
  MessageSquare,
  PanelTop,
  Play,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import type { ContextWindow, ThreadContext } from "../model";

const ROOT_PARENT_ID = "root";

type WindowTypeStyle = {
  icon: LucideIcon;
  label: string;
};

const TYPE_STYLE: Record<ContextWindow["type"], WindowTypeStyle> = {
  root: { icon: PanelTop, label: "root" },
  command_exec: { icon: FileCheck, label: "form" },
  do: { icon: Inbox, label: "do" },
  todo: { icon: ListChecks, label: "todo" },
  talk: { icon: MessageSquare, label: "talk" },
  program: { icon: Play, label: "program" },
  file: { icon: FileText, label: "file" },
  knowledge: { icon: ScrollText, label: "knowledge" },
};

function statusToTone(status?: string): "info" | "warning" | "success" | "error" {
  switch (status) {
    case "running":
    case "open":
    case "active":
      return "info";
    case "executing":
      return "warning";
    case "executed":
    case "done":
      return "success";
    case "failed":
    case "archived":
      return "error";
    default:
      return "info";
  }
}

function WindowDetails({ window }: { window: ContextWindow }) {
  if (window.type === "command_exec") {
    return (
      <div className="cw-details">
        <div className="cw-detail-row">
          <span className="cw-detail-label">command</span>
          <span className="cw-detail-value">{window.command}</span>
        </div>
        {window.description && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">desc</span>
            <span className="cw-detail-value">{window.description}</span>
          </div>
        )}
        {window.accumulatedArgs && Object.keys(window.accumulatedArgs).length > 0 && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">args</span>
            <pre className="cw-detail-pre">{JSON.stringify(window.accumulatedArgs, null, 2)}</pre>
          </div>
        )}
        {window.commandPaths && window.commandPaths.length > 0 && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">paths</span>
            <span className="cw-detail-value">{window.commandPaths.join(", ")}</span>
          </div>
        )}
        {window.status === "executed" && window.result && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">result</span>
            <pre className="cw-detail-pre">{window.result}</pre>
          </div>
        )}
      </div>
    );
  }

  if (window.type === "do") {
    return (
      <div className="cw-details">
        <div className="cw-detail-row">
          <span className="cw-detail-label">target</span>
          <span className="cw-detail-value">{window.targetThreadId}</span>
        </div>
        {window.isCreatorWindow && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">role</span>
            <span className="cw-detail-value">creator window（不可关闭）</span>
          </div>
        )}
      </div>
    );
  }

  if (window.type === "todo") {
    return (
      <div className="cw-details">
        <div className="cw-detail-row">
          <span className="cw-detail-label">content</span>
          <span className="cw-detail-value">{window.content}</span>
        </div>
        {window.onCommandPath && window.onCommandPath.length > 0 && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">on_command_path</span>
            <span className="cw-detail-value">{window.onCommandPath.join(", ")}</span>
          </div>
        )}
      </div>
    );
  }

  if (window.type === "talk") {
    return (
      <div className="cw-details">
        <div className="cw-detail-row">
          <span className="cw-detail-label">target</span>
          <span className="cw-detail-value">{window.target}</span>
        </div>
        <div className="cw-detail-row">
          <span className="cw-detail-label">conversation</span>
          <span className="cw-detail-value">{window.conversationId}</span>
        </div>
      </div>
    );
  }

  if (window.type === "program") {
    return (
      <div className="cw-details">
        <div className="cw-detail-row">
          <span className="cw-detail-label">execs</span>
          <span className="cw-detail-value">{window.history.length}</span>
        </div>
        {window.history.length > 0 && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">last</span>
            <pre className="cw-detail-pre">{window.history[window.history.length - 1]?.output}</pre>
          </div>
        )}
      </div>
    );
  }

  if (window.type === "file") {
    return (
      <div className="cw-details">
        <div className="cw-detail-row">
          <span className="cw-detail-label">path</span>
          <span className="cw-detail-value">{window.path}</span>
        </div>
        {window.lines && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">lines</span>
            <span className="cw-detail-value">{window.lines.join("-")}</span>
          </div>
        )}
        {window.columns && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">columns</span>
            <span className="cw-detail-value">{window.columns.join("-")}</span>
          </div>
        )}
      </div>
    );
  }

  if (window.type === "knowledge") {
    return (
      <div className="cw-details">
        <div className="cw-detail-row">
          <span className="cw-detail-label">path</span>
          <span className="cw-detail-value">{window.path}</span>
        </div>
        {window.source && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">source</span>
            <span className="cw-detail-value">{window.source}</span>
          </div>
        )}
        {window.presentation && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">presentation</span>
            <span className="cw-detail-value">{window.presentation}</span>
          </div>
        )}
        {window.description && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">description</span>
            <span className="cw-detail-value">{window.description}</span>
          </div>
        )}
        {window.body && (
          <div className="cw-detail-row">
            <span className="cw-detail-label">content</span>
            <pre className="cw-detail-pre">{window.body}</pre>
          </div>
        )}
      </div>
    );
  }

  return null;
}

/** 类型 narrow 后取 parentWindowId；root 没有这个字段，统一返回 undefined。 */
function parentOf(window: ContextWindow): string | undefined {
  if (window.type === "root") return undefined;
  return window.parentWindowId;
}

function WindowRow({
  window,
  allWindows,
  depth,
}: {
  window: ContextWindow;
  allWindows: ContextWindow[];
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const subWindows = allWindows.filter((w) => parentOf(w) === window.id);
  const tone = statusToTone(window.status);
  const Icon = TYPE_STYLE[window.type].icon;
  const typeLabel = TYPE_STYLE[window.type].label;
  const hasDetails = window.type !== "root";
  const hasSubWindows = subWindows.length > 0;
  const expandable = hasDetails || hasSubWindows;

  return (
    <div className={`cw-row cw-row-${window.type} cw-tone-${tone}`} style={{ paddingLeft: `${depth * 16}px` }}>
      <button
        type="button"
        className={`cw-row-head${expanded ? " is-open" : ""}`}
        onClick={() => expandable && setExpanded((v) => !v)}
        disabled={!expandable}
      >
        <span className="cw-chevron">
          {expandable ? (
            <ChevronRight size={12} className={expanded ? "cw-chevron-open" : ""} aria-hidden="true" />
          ) : (
            <CircleDot size={10} aria-hidden="true" />
          )}
        </span>
        <Icon size={12} aria-hidden="true" />
        <span className="cw-type">{typeLabel}</span>
        <span className="cw-title">{window.title}</span>
        {window.status && <span className={`cw-status cw-status-${tone}`}>{window.status}</span>}
        {window.type === "command_exec" && window.status === "executing" && (
          <Loader2 size={12} className="cw-spinner" aria-hidden="true" />
        )}
      </button>
      {expanded && hasDetails && <WindowDetails window={window} />}
      {expanded && hasSubWindows && (
        <div className="cw-sub-windows">
          {subWindows.map((sub) => (
            <WindowRow key={sub.id} window={sub} allWindows={allWindows} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ContextWindowsPanel({ thread }: { thread?: ThreadContext }) {
  const windows = thread?.contextWindows ?? [];
  if (windows.length === 0) {
    return null;
  }
  const topLevel = windows.filter((w) => {
    const parent = parentOf(w);
    return !parent || parent === ROOT_PARENT_ID;
  });
  if (topLevel.length === 0) {
    return null;
  }
  return (
    <div className="cw-panel">
      <div className="cw-panel-head">
        <span className="cw-panel-title">Context Windows</span>
        <span className="cw-panel-count">{windows.length}</span>
      </div>
      <div className="cw-panel-body">
        {topLevel.map((w) => (
          <WindowRow key={w.id} window={w} allWindows={windows} depth={0} />
        ))}
      </div>
    </div>
  );
}
