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
import { cn } from "../../lib/utils";
import { MarkdownContent } from "./MarkdownContent";
import { Copy, Check, ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import type { Action, FlowMessage } from "../../api/types";

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
  thought:     { prefix: "◆", color: "text-amber-500",  label: "thought" },
  program:     { prefix: "▸", color: "text-blue-400",   label: "program" },
  action:      { prefix: "▸", color: "text-sky-400",    label: "action" },
  inject:      { prefix: "›", color: "text-orange-400", label: "inject" },
  message_in:  { prefix: "←", color: "text-green-400",  label: "in" },
  message_out: { prefix: "→", color: "text-teal-400",   label: "out" },
  set_plan:    { prefix: "◇", color: "text-violet-400", label: "plan" },
  stack_push:  { prefix: "↓", color: "text-emerald-400", label: "push" },
  stack_pop:   { prefix: "↑", color: "text-cyan-400",   label: "pop" },
  pause:       { prefix: "⏸", color: "text-gray-400",   label: "pause" },
  create_thread:  { prefix: "⑂", color: "text-blue-400", label: "fork" },
  thread_return:  { prefix: "⏎", color: "text-green-400", label: "return" },
};
const DEFAULT_CONFIG = { prefix: "·", color: "text-gray-400", label: "unknown" };

/* ── 时间格式化 ── */
function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
}

export function TuiAction({ action, objectName, loading }: TuiActionProps) {
  const cfg = TYPE_CONFIG[action.type] ?? DEFAULT_CONFIG;
  const isInject = action.type === "inject";
  const isProgramOrAction = action.type === "program" || action.type === "action";
  const [expanded, setExpanded] = useState(!isInject);

  const injectParsed = isInject ? parseInjectTitle(action.content) : null;
  const displayContent = isInject ? (injectParsed?.body ?? action.content) : action.content;

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
        {objectName && (
          <span className="text-[var(--muted-foreground)] opacity-60">{objectName}</span>
        )}
        {isProgramOrAction && action.success !== undefined && (
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
        <div className="pl-5 mt-0.5">
          {isProgramOrAction ? (
            <div>
              <pre className="text-[11px] whitespace-pre-wrap break-all text-[var(--foreground)] opacity-90">{action.content}</pre>
              {action.result && (
                <div className="mt-1 border-l-2 border-[var(--border)] pl-2">
                  <span className="text-[10px] text-[var(--muted-foreground)]">output</span>
                  <pre className="text-[11px] whitespace-pre-wrap break-all text-[var(--foreground)] opacity-70">{action.result}</pre>
                </div>
              )}
            </div>
          ) : action.type === "thought" ? (
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
        {type === "thought" ? (
          <div className="text-[var(--foreground)] opacity-70 italic">
            <MarkdownContent content={content} className="text-[12px] leading-relaxed" />
          </div>
        ) : type === "program" || type === "action" ? (
          <pre className="text-[11px] whitespace-pre-wrap break-all text-[var(--foreground)] opacity-90">{content}</pre>
        ) : (
          <MarkdownContent content={content} className="text-[12px] leading-relaxed" />
        )}
      </div>
    </div>
  );
}
