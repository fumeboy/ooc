/**
 * TUI 风格消息组件
 *
 * 模仿 Claude Code TUI 的设计语言：
 * - 无卡片边框，内容直接流式展示
 * - 行前缀标记区分类型（❯ ◆ ▸ ✓ ✗ 等）
 * - 等宽字体为主，正文可用比例字体
 * - 颜色极简：绿=成功、红=错误、灰=次要、蓝=链接、琥珀=思考
 * - 支持折叠/展开长内容
 * - 支持 SSE 流式追加（loading 状态）
 */
import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../lib/utils";
import { MarkdownContent } from "./MarkdownContent";
import { Copy, Check, ChevronRight, ChevronDown, Loader2, Maximize2, X } from "lucide-react";
import type { Action, FlowMessage } from "../../api/types";

/** program/action 内容截断阈值 */
const TRUNCATE_MAX_LINES = 8;
const TRUNCATE_MAX_CHARS = 300;

/* ── 复制按钮 ── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="opacity-0 group-hover:opacity-100 ml-1 inline-flex items-center justify-center w-5 h-5 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-all"
      title={copied ? "已复制" : "复制"}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

/* ── 类型前缀配置 ── */
const TYPE_CONFIG: Record<string, { prefix: string; color: string; label: string }> = {
  thinking:       { prefix: "◆", color: "text-amber-500",  label: "thinking" },
  text:           { prefix: "◇", color: "text-slate-400",  label: "text" },
  tool_use:       { prefix: "⚙", color: "text-blue-400",   label: "tool" },
  program:        { prefix: "▸", color: "text-blue-400",   label: "program" },
  inject:         { prefix: "›", color: "text-orange-400", label: "inject" },
  message_in:     { prefix: "←", color: "text-green-400",  label: "in" },
  message_out:    { prefix: "→", color: "text-teal-400",   label: "out" },
  set_plan:       { prefix: "◇", color: "text-violet-400", label: "plan" },
  mark_inbox:     { prefix: "✓", color: "text-emerald-400", label: "mark" },
  create_thread:  { prefix: "⑂", color: "text-blue-400", label: "fork" },
  thread_return:  { prefix: "⏎", color: "text-green-400", label: "return" },
};
const DEFAULT_CONFIG = { prefix: "·", color: "text-gray-400", label: "unknown" };

/* ── 时间格式化 ── */
function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ── 文本截断工具（行数 + 字符数双重限制） ── */
function truncateText(text: string): { truncated: string; isTruncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= TRUNCATE_MAX_LINES && text.length <= TRUNCATE_MAX_CHARS) {
    return { truncated: text, isTruncated: false };
  }
  /* 先按行截断 */
  let result = lines.length > TRUNCATE_MAX_LINES
    ? lines.slice(0, TRUNCATE_MAX_LINES).join("\n")
    : text;
  /* 再按字符截断 */
  if (result.length > TRUNCATE_MAX_CHARS) {
    result = result.slice(0, TRUNCATE_MAX_CHARS);
  }
  return { truncated: result + " …", isTruncated: true };
}

/* ── 全文模态窗 ── */
function FullTextModal({ open, onClose, title, content, result }: {
  open: boolean;
  onClose: () => void;
  title: string;
  content: string;
  result?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed z-50 inset-4 md:inset-[10%] flex flex-col bg-[var(--card)] rounded-xl shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
            <span className="font-mono text-sm font-semibold">{title}</span>
            <DialogPrimitive.Close className="p-1 rounded hover:bg-[var(--accent)] transition-colors">
              <X className="w-4 h-4" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Title>
          <div className="flex-1 overflow-auto p-4 font-mono text-[12px]">
            <pre className="whitespace-pre-wrap break-all text-[var(--foreground)]">{content}</pre>
            {result && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <span className="text-[10px] text-[var(--muted-foreground)] font-semibold uppercase tracking-wider">output</span>
                <pre className="mt-1 whitespace-pre-wrap break-all text-[var(--foreground)] opacity-70">{result}</pre>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ── inject 内容解析 ── */
function parseInjectTitle(content: string): { title: string; body: string } {
  const m = content.match(/^>>>\s*\[系统提示 — ([^\|\]]+)(?:\s*\|\s*([^\]]+))?\]\s*(\n|$)/);
  if (m) {
    const title = m[2]?.trim() || m[1]?.trim() || "系统提示";
    return { title, body: content.slice(m[0].length) };
  }
  const firstLine = content.split("\n")[0] || "";
  return { title: firstLine.slice(0, 60), body: content };
}

/* ================================================================
 *  TuiAction — 替代 ActionCard
 * ================================================================ */

interface TuiActionProps {
  action: Action;
  objectName?: string;
  loading?: boolean;
  /** 内容区域最大高度（超出时可滚动，默认不限制） */
  maxHeight?: number | string;
}

export function TuiAction({ action, objectName, loading, maxHeight }: TuiActionProps) {
  const cfg = TYPE_CONFIG[action.type] ?? DEFAULT_CONFIG;
  const isInject = action.type === "inject";
  const isThinking = action.type === "thinking";
  const isProgram = action.type === "program";
  const isToolUse = action.type === "tool_use";
  const [expanded, setExpanded] = useState(!isInject);
  const [modalOpen, setModalOpen] = useState(false);

  /* tool_use: 显示工具名+参数摘要 */
  const toolLabel = isToolUse && action.name
    ? `${action.name}(${Object.keys(action.args ?? {}).slice(0, 3).join(", ")}${Object.keys(action.args ?? {}).length > 3 ? "..." : ""})`
    : null;

  const injectParsed = isInject ? parseInjectTitle(action.content) : null;
  const displayContent = isInject ? (injectParsed?.body ?? action.content) : action.content;

  /* program 截断 */
  const contentTrunc = isProgram ? truncateText(action.content) : null;
  const resultTrunc = isProgram && action.result ? truncateText(action.result) : null;
  const needsModal = contentTrunc?.isTruncated || resultTrunc?.isTruncated;

  /* tool_use 的自叙标题 title 作为主文案显示，优先级高于 toolLabel */
  const hasTitle = isToolUse && typeof action.title === "string" && action.title.trim().length > 0;

  return (
    <div className="group font-mono text-[12px] leading-relaxed">
      {/* 头部行 */}
      <div
        className={cn(
          "flex items-baseline gap-1.5",
          isInject && "cursor-pointer",
        )}
        onClick={isInject ? () => setExpanded(!expanded) : undefined}
      >
        <span className={cn("shrink-0 select-none", cfg.color)}>{cfg.prefix}</span>
        <span className={cn("shrink-0 font-semibold", cfg.color)}>{cfg.label}</span>
        {hasTitle ? (
          <>
            {/* 主标题：tool call 的自叙行动标题 */}
            <span className="text-[var(--foreground)] font-medium truncate">{action.title}</span>
            {/* 副标题：原 toolName(args) 摘要，次级色、小字 */}
            {toolLabel && (
              <span className="text-[var(--muted-foreground)] text-[10px] opacity-70 truncate">
                {toolLabel}
              </span>
            )}
          </>
        ) : (
          toolLabel && (
            <span className="text-[var(--foreground)] opacity-80 truncate">{toolLabel}</span>
          )
        )}
        {objectName && (
          <span className="text-[var(--muted-foreground)] opacity-60">{objectName}</span>
        )}
        {isProgram && action.success !== undefined && (
          <span className={action.success === false ? "text-red-400 font-semibold" : "text-green-400 font-semibold"}>
            {action.success === false ? "✗" : "✓"}
          </span>
        )}
        {loading && <Loader2 className="w-3 h-3 animate-spin text-[var(--muted-foreground)]" />}
        {isInject && (
          <>
            <span className="text-[var(--muted-foreground)] truncate flex-1">{injectParsed?.title}</span>
            <span className="text-[var(--muted-foreground)] shrink-0">
              {expanded ? <ChevronDown className="w-3 h-3 inline" /> : <ChevronRight className="w-3 h-3 inline" />}
            </span>
          </>
        )}
        <span className="text-[var(--muted-foreground)] opacity-40 shrink-0 ml-auto">{formatTs(action.timestamp)}</span>
        <CopyBtn text={action.content} />
      </div>

      {/* 内容区 */}
      {expanded && (
        <div
          className="pl-5 mt-0.5"
          style={maxHeight != null
            ? { maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight, overflow: "auto" }
            : undefined}
        >
          {isProgram ? (
            <div>
              <pre className="text-[11px] whitespace-pre-wrap break-all text-[var(--foreground)] opacity-90">
                {contentTrunc!.truncated}
              </pre>
              {action.result && (
                <div className="mt-1 border-l-2 border-[var(--border)] pl-2">
                  <span className="text-[10px] text-[var(--muted-foreground)]">output</span>
                  <pre className="text-[11px] whitespace-pre-wrap break-all text-[var(--foreground)] opacity-70">
                    {resultTrunc!.truncated}
                  </pre>
                </div>
              )}
              {needsModal && (
                <button
                  onClick={() => setModalOpen(true)}
                  className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>查看全文</span>
                </button>
              )}
              {needsModal && (
                <FullTextModal
                  open={modalOpen}
                  onClose={() => setModalOpen(false)}
                  title={`${cfg.label} — ${objectName ?? ""}`}
                  content={action.content}
                  result={action.result}
                />
              )}
            </div>
          ) : isThinking ? (
            <div className="text-[var(--foreground)] opacity-70 italic">
              <MarkdownContent content={displayContent} className="text-[12px] leading-relaxed" />
            </div>
          ) : (
            <div className="text-[var(--foreground)] opacity-90">
              <MarkdownContent content={displayContent} className="text-[12px] leading-relaxed" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================
 *  TuiTalk — 替代 TalkCard（对象回复）
 * ================================================================ */

interface TuiTalkProps {
  msg: FlowMessage;
  loading?: boolean;
}

export function TuiTalk({ msg, loading }: TuiTalkProps) {
  return (
    <div className="group font-mono text-[12px] leading-relaxed">
      {/* 头部行 */}
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 select-none text-violet-400">❯</span>
        <span className="shrink-0 font-semibold text-violet-400">talk</span>
        <span className="text-[var(--muted-foreground)] opacity-60">{msg.from} → {msg.to}</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-[var(--muted-foreground)]" />}
        <span className="text-[var(--muted-foreground)] opacity-40 shrink-0 ml-auto">{formatTs(msg.timestamp)}</span>
        <CopyBtn text={msg.content} />
      </div>

      {/* 内容 */}
      <div className="pl-5 mt-0.5">
        <MarkdownContent content={msg.content} className="text-[13px] leading-relaxed" />
      </div>
    </div>
  );
}

/* ================================================================
 *  TuiUserMessage — 替代 MessageBubble（用户输入）
 * ================================================================ */

interface TuiUserMessageProps {
  msg: FlowMessage;
}

export function TuiUserMessage({ msg }: TuiUserMessageProps) {
  return (
    <div className="group font-mono text-[12px] leading-relaxed">
      <div className="flex items-baseline gap-1.5">
        <span className="shrink-0 select-none text-[var(--foreground)]">&gt;</span>
        <span className="text-[var(--foreground)]">{msg.content}</span>
        <span className="text-[var(--muted-foreground)] opacity-40 shrink-0 ml-auto">{formatTs(msg.timestamp)}</span>
      </div>
    </div>
  );
}

/* ================================================================
 *  TuiStreamingBlock — 流式输出占位（SSE 正在输出时）
 * ================================================================ */

interface TuiStreamingBlockProps {
  type: string;
  content: string;
  objectName?: string;
}

export function TuiStreamingBlock({ type, content, objectName }: TuiStreamingBlockProps) {
  const cfg = TYPE_CONFIG[type] ?? DEFAULT_CONFIG;

  return (
    <div className="font-mono text-[12px] leading-relaxed animate-pulse">
      <div className="flex items-baseline gap-1.5">
        <span className={cn("shrink-0 select-none", cfg.color)}>{cfg.prefix}</span>
        <span className={cn("shrink-0 font-semibold", cfg.color)}>{cfg.label}</span>
        {objectName && (
          <span className="text-[var(--muted-foreground)] opacity-60">{objectName}</span>
        )}
        <Loader2 className="w-3 h-3 animate-spin text-[var(--muted-foreground)]" />
      </div>
      <div className="pl-5 mt-0.5">
        {type === "thinking" ? (
          <div className="text-[var(--foreground)] opacity-70 italic">
            <MarkdownContent content={content} className="text-[12px] leading-relaxed" />
          </div>
        ) : type === "program" ? (
          <pre className="text-[11px] whitespace-pre-wrap break-all text-[var(--foreground)] opacity-90">{content}</pre>
        ) : (
          <MarkdownContent content={content} className="text-[12px] leading-relaxed" />
        )}
      </div>
    </div>
  );
}
