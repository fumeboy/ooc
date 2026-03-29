/**
 * ActionCard / TalkCard — 统一的 action 和 talk 卡片组件
 *
 * 用于 ProcessView 和 ChatPage Timeline 两处渲染。
 * 包含工具栏：Zoom-in、Copy、Ref 按钮。
 * ID + 时间显示在卡片底部（边框外）。
 * Zoom-in 使用居中模态窗展示。
 */
import { useState, useRef, useEffect } from "react";
import { cn } from "../../lib/utils";
import { MarkdownContent } from "./MarkdownContent";
import { ObjectAvatar } from "./ObjectAvatar";
import { Maximize2, Copy, Link, Check, X, Loader2 } from "lucide-react";
import type { Action, FlowMessage } from "../../api/types";

const ACTION_BADGE: Record<string, string> = {
  thought: "text-amber-700 dark:text-amber-300",
  program: "text-blue-700 dark:text-blue-300",
  inject: "text-orange-700 dark:text-orange-300",
  message_in: "text-green-700 dark:text-green-300",
  message_out: "text-teal-700 dark:text-teal-300",
  pause: "text-gray-600 dark:text-gray-300",
};
const DEFAULT_BADGE = "text-gray-600 dark:text-gray-300";

/* ── 小型工具栏按钮 ── */
function ToolbarBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="w-6 h-6 flex items-center justify-center rounded text-[var(--muted-foreground)] hover:bg-[var(--accent)] transition-colors"
    >
      {children}
    </button>
  );
}

/* ── 复制按钮（带 Copied 反馈） ── */
function CopyBtn({ text, title = "复制" }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ToolbarBtn title={copied ? "已复制" : title} onClick={handleCopy}>
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </ToolbarBtn>
  );
}

/* ── 内联小型复制按钮（用于 Program/Output 区块标题） ── */
function InlineCopyBtn({ text, title = "复制" }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      title={copied ? "已复制" : title}
      onClick={(e) => {
        e.stopPropagation();
        handleCopy();
      }}
      className="w-5 h-5 inline-flex items-center justify-center rounded text-[var(--muted-foreground)] hover:bg-[var(--accent)] transition-colors ml-1"
    >
      {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
    </button>
  );
}

/* ── 居中模态窗 ── */
function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-[680px] max-w-[90vw] max-h-[85vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

/* ================================================================
 *  ActionCard
 * ================================================================ */

interface ActionCardProps {
  action: Action;
  objectName?: string;
  maxHeight?: number | string;
  onRef?: (id: string, objectName: string) => void;
  /** 是否正在通过 SSE 更新 */
  loading?: boolean;
}

export function ActionCard({ action, objectName, maxHeight = 220, onRef, loading }: ActionCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight);
  });

  const isProgram = action.type === "program";
  const badgeColor = ACTION_BADGE[action.type] ?? DEFAULT_BADGE;
  const R = 8;
  const ts = new Date(action.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const bodyOverflow = focused ? "auto" : "hidden";
  const maxHeightStyle = maxHeight != null
    ? typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight
    : undefined;

  return (
    <div className="text-xs">
      <div
        className={cn(
          "bg-[var(--muted)] overflow-hidden p-[4px] shadow-sm border transition-colors",
          focused ? "border-[var(--foreground)]" : "border-[var(--border)]",
        )}
        style={{ borderRadius: `${R}px`, ...(focused ? { borderColor: "color-mix(in srgb, var(--foreground) 40%, transparent)" } : {}) }}
        onClick={() => setFocused(true)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setFocused(false); setHovered(false); }}
      >
        {/* header */}
        <div className="flex items-stretch min-h-[28px]">
          <div
            className="relative bg-[var(--card)] flex items-center gap-1.5 px-3 py-1 shrink-0"
            style={{ borderRadius: `${R}px ${R}px 0 0` }}
          >
            {objectName && (
              <>
                <ObjectAvatar name={objectName} size="sm" />
                <span className="text-[10px] text-[var(--muted-foreground)]">{objectName}</span>
                <span className="text-[var(--border)] mx-0.5">|</span>
              </>
            )}
            <span className={cn("text-[11px] font-mono", badgeColor)}>[{action.type}]</span>
            {loading && <Loader2 className="w-3 h-3 animate-spin text-[var(--muted-foreground)]" />}
            {isProgram && action.success !== undefined && (
              <span
                className={cn(
                  "text-[10px] font-semibold",
                  action.success === false ? "text-red-500 dark:text-red-400" : "text-green-500 dark:text-green-400",
                )}
              >
                {action.success === false ? "FAIL" : "OK"}
              </span>
            )}
            <div
              className="absolute bottom-0 z-10"
              style={{
                right: `-${R}px`,
                width: `${R}px`,
                height: `${R}px`,
                background: `radial-gradient(circle at 100% 0%, transparent ${R}px, var(--card) ${R}px)`,
              }}
            />
          </div>

          {/* 右侧：工具栏 */}
          <div className="flex-1 flex items-center justify-end gap-0.5 px-3">
            <ToolbarBtn title="展开详情" onClick={() => setModalOpen(true)}>
              <Maximize2 className="w-3 h-3" />
            </ToolbarBtn>
            {!isProgram && <CopyBtn text={action.content} title="复制内容" />}
            {action.id && objectName && (
              <ToolbarBtn title="引用" onClick={() => onRef?.(action.id!, objectName)}>
                <Link className="w-3 h-3" />
              </ToolbarBtn>
            )}
          </div>
        </div>

        {/* body */}
        <div className="relative bg-[var(--card)]" style={{ borderRadius: `0 ${R}px ${R}px ${R}px` }}>
          <div
            className="absolute top-0 z-10"
            style={{
              left: "-1px",
              width: `${R}px`,
              height: `${R}px`,
              background: `radial-gradient(circle at 0% 100%, transparent ${R}px, var(--card) ${R}px)`,
            }}
          />
          {isProgram ? (
            <div className="@container">
              <div className="flex flex-col @[600px]:flex-row divide-y @[600px]:divide-y-0 @[600px]:divide-x divide-[var(--border)]">
              <div ref={contentRef} className="flex-1 min-w-0" style={{ maxHeight: maxHeightStyle, overflow: maxHeightStyle ? bodyOverflow : undefined }}>
                <div className="px-3 py-2">
                  <p className="text-[10px] text-[var(--muted-foreground)] mb-1 font-medium flex items-center">
                    Program
                    <InlineCopyBtn text={action.content} title="复制 Program" />
                  </p>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-all leading-relaxed">{action.content}</pre>
                </div>
              </div>
              {action.result && (
                <div className="flex-1 min-w-0" style={{ maxHeight: maxHeightStyle, overflow: maxHeightStyle ? bodyOverflow : undefined }}>
                  <div className="px-3 py-2">
                    <p className="text-[10px] text-[var(--muted-foreground)] mb-1 font-medium flex items-center">
                      Output
                      <InlineCopyBtn text={action.result} title="复制 Output" />
                    </p>
                    <pre className="text-[11px] font-mono whitespace-pre-wrap break-all leading-relaxed">{action.result}</pre>
                  </div>
                </div>
              )}
              </div>
            </div>
          ) : (
            <div ref={contentRef} style={{ maxHeight: maxHeightStyle, overflow: maxHeightStyle ? bodyOverflow : undefined }}>
              <div className="px-3 py-4">
                <MarkdownContent content={action.content} className="text-sm leading-relaxed" />
              </div>
            </div>
          )}
          {overflows && (
            <div
              className="absolute bottom-0 left-0 right-0 flex items-end justify-center pb-2 pt-8 pointer-events-none transition-opacity duration-200"
              style={{
                background: "linear-gradient(transparent, var(--card))",
                borderRadius: `0 0 ${R}px ${R}px`,
                opacity: hovered && !focused ? 1 : 0,
              }}
            >
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">Click to Scroll</span>
            </div>
          )}
        </div>
      </div>

      {/* 卡片尾部：ID + 时间（边框外） */}
      <div className="flex items-center gap-1.5 px-2 pt-1">
        {action.id && (
          <span className="text-[9px] font-mono text-[var(--muted-foreground)] opacity-50 truncate max-w-[100px]">
            {action.id}
          </span>
        )}
        <span className="text-[9px] text-[var(--muted-foreground)] opacity-50">{ts}</span>
      </div>

      {/* Zoom-in 模态窗 */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <div className="flex items-center gap-2 mb-4">
          <span className={cn("text-xs font-mono", badgeColor)}>[{action.type}]</span>
          {isProgram && action.success !== undefined && (
            <span
              className={cn(
                "text-xs font-semibold",
                action.success === false ? "text-red-500 dark:text-red-400" : "text-green-500 dark:text-green-400",
              )}
            >
              {action.success === false ? "FAIL" : "OK"}
            </span>
          )}
          <span className="text-xs text-[var(--muted-foreground)]">{ts}</span>
          {action.id && (
            <span className="text-[10px] font-mono text-[var(--muted-foreground)] opacity-60">{action.id}</span>
          )}
        </div>
        {isProgram ? (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-[var(--muted-foreground)] mb-1 font-medium">Program</p>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">{action.content}</pre>
            </div>
            {action.result && (
              <div>
                <p className="text-xs text-[var(--muted-foreground)] mb-1 font-medium">Output</p>
                <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">{action.result}</pre>
              </div>
            )}
          </div>
        ) : (
          <MarkdownContent content={action.content} className="text-sm leading-relaxed" />
        )}
      </Modal>
    </div>
  );
}

/* ================================================================
 *  TalkCard
 * ================================================================ */

interface TalkCardProps {
  msg: FlowMessage;
  maxHeight?: number | string;
  onRef?: (id: string, objectName: string) => void;
}

export function TalkCard({ msg, maxHeight = 300, onRef }: TalkCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight);
  });

  const R = 8;
  const ts = new Date(msg.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const maxHeightStyle = maxHeight != null && maxHeight !== 0
    ? typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight
    : undefined;

  return (
    <div className="text-xs">
      <div
        className={cn(
          "bg-[var(--muted)] overflow-hidden p-[4px] shadow-sm border transition-colors",
          focused ? "border-[var(--foreground)]" : "border-[var(--border)]",
        )}
        style={{ borderRadius: `${R}px`, ...(focused ? { borderColor: "color-mix(in srgb, var(--foreground) 40%, transparent)" } : {}) }}
        onClick={() => setFocused(true)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setFocused(false); setHovered(false); }}
      >
        {/* header */}
        <div className="flex items-stretch min-h-[28px]">
          <div
            className="relative bg-[var(--card)] flex items-center gap-1.5 px-3 py-1 shrink-0"
            style={{ borderRadius: `${R}px ${R}px 0 0` }}
          >
            <ObjectAvatar name={msg.from} size="sm" />
            <span className="text-[10px] text-[var(--muted-foreground)]">{msg.from}</span>
            <span className="text-[var(--border)] mx-0.5">→</span>
            <span className="text-[10px] text-[var(--muted-foreground)]">{msg.to}</span>
            <span className="text-[var(--border)] mx-0.5">|</span>
            <span className="text-[11px] font-mono text-violet-700 dark:text-violet-300">[talk]</span>
            <div
              className="absolute bottom-0 z-10"
              style={{
                right: `-${R}px`,
                width: `${R}px`,
                height: `${R}px`,
                background: `radial-gradient(circle at 100% 0%, transparent ${R}px, var(--card) ${R}px)`,
              }}
            />
          </div>

          {/* 右侧：工具栏 */}
          <div className="flex-1 flex items-center justify-end gap-0.5 px-3">
            <ToolbarBtn title="展开详情" onClick={() => setModalOpen(true)}>
              <Maximize2 className="w-3 h-3" />
            </ToolbarBtn>
            <CopyBtn text={msg.content} title="复制内容" />
            {msg.id && (
              <ToolbarBtn title="引用" onClick={() => onRef?.(msg.id!, msg.from)}>
                <Link className="w-3 h-3" />
              </ToolbarBtn>
            )}
          </div>
        </div>

        {/* body */}
        <div className="relative bg-[var(--card)]" style={{ borderRadius: `0 ${R}px ${R}px ${R}px` }}>
          <div
            className="absolute top-0 z-10"
            style={{
              left: "-1px",
              width: `${R}px`,
              height: `${R}px`,
              background: `radial-gradient(circle at 0% 100%, transparent ${R}px, var(--card) ${R}px)`,
            }}
          />
          <div ref={contentRef} style={{ maxHeight: maxHeightStyle, overflow: maxHeightStyle ? (focused ? "auto" : "hidden") : undefined }}>
            <div className="px-3 py-4">
              <MarkdownContent content={msg.content} className="text-sm leading-relaxed" />
            </div>
          </div>
          {overflows && (
            <div
              className="absolute bottom-0 left-0 right-0 flex items-end justify-center pb-2 pt-8 pointer-events-none transition-opacity duration-200"
              style={{
                background: "linear-gradient(transparent, var(--card))",
                borderRadius: `0 0 ${R}px ${R}px`,
                opacity: hovered && !focused ? 1 : 0,
              }}
            >
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]">Click to Scroll</span>
            </div>
          )}
        </div>
      </div>

      {/* 卡片尾部：ID + 时间（边框外） */}
      <div className="flex items-center gap-1.5 px-2 pt-1">
        {msg.id && (
          <span className="text-[9px] font-mono text-[var(--muted-foreground)] opacity-50 truncate max-w-[100px]">
            {msg.id}
          </span>
        )}
        <span className="text-[9px] text-[var(--muted-foreground)] opacity-50">{ts}</span>
      </div>

      {/* Zoom-in 模态窗 */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        <div className="flex items-center gap-2 mb-4">
          <ObjectAvatar name={msg.from} size="sm" />
          <span className="text-xs text-[var(--muted-foreground)]">{msg.from}</span>
          <span className="text-[var(--border)]">→</span>
          <span className="text-xs text-[var(--muted-foreground)]">{msg.to}</span>
          <span className="text-xs font-mono text-violet-700 dark:text-violet-300">[talk]</span>
          <span className="text-xs text-[var(--muted-foreground)]">{ts}</span>
          {msg.id && (
            <span className="text-[10px] font-mono text-[var(--muted-foreground)] opacity-60">{msg.id}</span>
          )}
        </div>
        <MarkdownContent content={msg.content} className="text-sm leading-relaxed" />
      </Modal>
    </div>
  );
}
