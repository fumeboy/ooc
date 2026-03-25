/**
 * ActionCard / TalkCard — 统一的 action 和 talk 卡片组件
 *
 * 用于 ProcessView 和 ChatPage Timeline 两处渲染。
 * 包含工具栏：ID 显示、Zoom-in、Copy、Ref 按钮。
 */
import { useState } from "react";
import { cn } from "../../lib/utils";
import { MarkdownContent } from "./MarkdownContent";
import { ObjectAvatar } from "./ObjectAvatar";
import { Maximize2, Copy, Link, Check } from "lucide-react";
import { Sheet, SheetContent } from "./sheet";
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

/* ================================================================
 *  ActionCard
 * ================================================================ */

interface ActionCardProps {
  action: Action;
  /** 显示 object 头像和名称（Timeline 模式） */
  objectName?: string;
  maxHeight?: number;
  /** 引用回调：点击 Ref 按钮时触发 */
  onRef?: (id: string, objectName: string) => void;
}

export function ActionCard({ action, objectName, maxHeight = 220, onRef }: ActionCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focused, setFocused] = useState(false);

  const isProgram = action.type === "program";
  const badgeColor = ACTION_BADGE[action.type] ?? DEFAULT_BADGE;
  const R = 8;
  const ts = new Date(action.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const bodyOverflow = focused ? "auto" : "hidden";

  return (
    <div className="text-xs">
      <div
        className={cn(
          "bg-[var(--muted)] overflow-hidden p-[4px] shadow-sm border transition-colors",
          focused ? "border-[var(--foreground)]" : "border-[var(--border)]",
        )}
        style={{ borderRadius: `${R}px`, ...(focused ? { borderColor: "color-mix(in srgb, var(--foreground) 40%, transparent)" } : {}) }}
        onClick={() => setFocused(true)}
        onMouseLeave={() => setFocused(false)}
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

          {/* 右侧：ID + 时间 + 工具栏 */}
          <div className="flex-1 flex items-center justify-end gap-1.5 px-3">
            {action.id && (
              <span className="text-[9px] font-mono text-[var(--muted-foreground)] opacity-60 truncate max-w-[80px]">
                {action.id}
              </span>
            )}
            <span className="text-[10px] text-[var(--muted-foreground)]">{ts}</span>
            <div className="flex items-center gap-0.5">
              {/* Zoom-in */}
              <ToolbarBtn title="展开详情" onClick={() => setSheetOpen(true)}>
                <Maximize2 className="w-3 h-3" />
              </ToolbarBtn>
              {/* Copy（非 program 类型才在 header 显示） */}
              {!isProgram && <CopyBtn text={action.content} title="复制内容" />}
              {/* Ref */}
              {action.id && objectName && (
                <ToolbarBtn title="引用" onClick={() => onRef?.(action.id!, objectName)}>
                  <Link className="w-3 h-3" />
                </ToolbarBtn>
              )}
            </div>
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
            <div className="flex divide-x divide-[var(--border)]">
              <div className="flex-1 min-w-0" style={{ maxHeight: `${maxHeight}px`, overflow: bodyOverflow }}>
                <div className="px-3 py-2">
                  <p className="text-[10px] text-[var(--muted-foreground)] mb-1 font-medium flex items-center">
                    Program
                    <InlineCopyBtn text={action.content} title="复制 Program" />
                  </p>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-all leading-relaxed">{action.content}</pre>
                </div>
              </div>
              {action.result && (
                <div className="flex-1 min-w-0" style={{ maxHeight: `${maxHeight}px`, overflow: bodyOverflow }}>
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
          ) : (
            <div style={{ maxHeight: `${maxHeight}px`, overflow: bodyOverflow }}>
              <div className="px-3 py-4">
                <MarkdownContent content={action.content} className="text-sm leading-relaxed" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Zoom-in Sheet 弹窗 */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-[520px] max-w-[90vw] overflow-y-auto p-6">
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
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ================================================================
 *  TalkCard
 * ================================================================ */

interface TalkCardProps {
  msg: FlowMessage;
  maxHeight?: number;
  /** 引用回调：点击 Ref 按钮时触发 */
  onRef?: (id: string, objectName: string) => void;
}

export function TalkCard({ msg, maxHeight = 300, onRef }: TalkCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focused, setFocused] = useState(false);

  const R = 8;
  const ts = new Date(msg.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="text-xs">
      <div
        className={cn(
          "bg-[var(--muted)] overflow-hidden p-[4px] shadow-sm border transition-colors",
          focused ? "border-[var(--foreground)]" : "border-[var(--border)]",
        )}
        style={{ borderRadius: `${R}px`, ...(focused ? { borderColor: "color-mix(in srgb, var(--foreground) 40%, transparent)" } : {}) }}
        onClick={() => setFocused(true)}
        onMouseLeave={() => setFocused(false)}
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

          {/* 右侧：ID + 时间 + 工具栏 */}
          <div className="flex-1 flex items-center justify-end gap-1.5 px-3">
            {msg.id && (
              <span className="text-[9px] font-mono text-[var(--muted-foreground)] opacity-60 truncate max-w-[80px]">
                {msg.id}
              </span>
            )}
            <span className="text-[10px] text-[var(--muted-foreground)]">{ts}</span>
            <div className="flex items-center gap-0.5">
              {/* Zoom-in */}
              <ToolbarBtn title="展开详情" onClick={() => setSheetOpen(true)}>
                <Maximize2 className="w-3 h-3" />
              </ToolbarBtn>
              {/* Copy */}
              <CopyBtn text={msg.content} title="复制内容" />
              {/* Ref */}
              {msg.id && (
                <ToolbarBtn title="引用" onClick={() => onRef?.(msg.id!, msg.from)}>
                  <Link className="w-3 h-3" />
                </ToolbarBtn>
              )}
            </div>
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
          <div style={{ maxHeight: `${maxHeight}px`, overflow: focused ? "auto" : "hidden" }}>
            <div className="px-3 py-4">
              <MarkdownContent content={msg.content} className="text-sm leading-relaxed" />
            </div>
          </div>
        </div>
      </div>

      {/* Zoom-in Sheet 弹窗 */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-[520px] max-w-[90vw] overflow-y-auto p-6">
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
        </SheetContent>
      </Sheet>
    </div>
  );
}
