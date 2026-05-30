import { ChevronDown, CircleX, Clock3, Copy, ExternalLink, FolderPlus, Info, Loader2, ShieldCheck, SendHorizontal, SlidersHorizontal, Wrench, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ChatLine } from "../model";
import { decideChatPermission } from "../query";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { InlineUiContent } from "../../../shared/ui/InlineUiContent";
import { dispatchNavigateToWindow } from "../../files/navigation-events";

const ROLE_CONFIG: Record<ChatLine["role"], { prefix?: string; icon?: LucideIcon; label: string; className: string }> = {
  user: { prefix: ">", label: "user", className: "tui-user" },
  assistant: { prefix: "❯", label: "assistant", className: "tui-assistant" },
  tool: { icon: Wrench, label: "tool", className: "tui-tool" },
  notice: { icon: Info, label: "notice", className: "tui-notice" },
};

const TOOL_ICON_CONFIG: Record<string, LucideIcon> = {
  open: FolderPlus,
  refine: SlidersHorizontal,
  submit: SendHorizontal,
  close: CircleX,
  wait: Clock3,
};

function getToolIcon(toolName: string): LucideIcon {
  return TOOL_ICON_CONFIG[toolName] ?? Wrench;
}

function buildCopyText(line: ChatLine) {
  if (line.kind === "message") return line.content;
  if (line.kind === "notice") return `${line.title}\n${line.content}`;
  if (line.kind === "permission_card") {
    return `permission_ask command=${line.command}${line.argsSummary ? `\nargs=${line.argsSummary}` : ""}${line.windowId ? `\nwindow=${line.windowId}` : ""}`;
  }
  return JSON.stringify(
    {
      toolName: line.toolName,
      callId: line.callId,
      arguments: line.argumentsText,
      output: line.outputText,
      ok: line.ok,
      pending: line.pending,
    },
    null,
    2,
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="tui-copy"
      onClick={(event) => {
        event.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={copied ? "已复制" : "复制"}
    >
      {copied ? "✓" : <Copy size={12} />}
    </button>
  );
}

function ToolFieldList({ line }: { line: Extract<ChatLine, { kind: "tool" }> }) {
  if (!line.summaryFields?.length) return null;
  return (
    <div className="tui-tool-field-list">
      {line.summaryFields.map((field, index) => (
        <div className="tui-tool-field" key={`${field.label}-${index}`}>
          <div className="tui-tool-field-label">{field.label}</div>
          <pre className="tui-pre tui-tool-field-value">{field.value}</pre>
        </div>
      ))}
    </div>
  );
}

type ToolPanelKey = "marks" | "arguments" | "output";

function ToolFooterButton({ label, open, onClick }: { label: ToolPanelKey; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`tui-tool-collapse-toggle${open ? " is-open" : ""}`} onClick={onClick}>
      <ChevronDown size={12} className="tui-tool-collapse-icon" />
      <span>{open ? `${label}` : `${label}`}</span>
    </button>
  );
}

function ToolMarksPanel({ line }: { line: Extract<ChatLine, { kind: "tool" }> }) {
  if (!line.marks?.length) return null;
  return (
    <div className="tui-tool-collapse-body">
      <div className="tui-tool-marks">
        {line.marks.map((mark, index) => (
          <div className="tui-tool-mark" key={`${mark.messageId ?? "mark"}-${index}`}>
            {mark.messageId && <div><span className="tui-tool-mark-label">message</span>{mark.messageId}</div>}
            {mark.type && <div><span className="tui-tool-mark-label">type</span>{mark.type}</div>}
            {mark.tip && <div><span className="tui-tool-mark-label">tip</span>{mark.tip}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolExpandedPanels({ line, openPanels }: { line: Extract<ChatLine, { kind: "tool" }>; openPanels: Record<ToolPanelKey, boolean> }) {
  return (
    <div className="tui-tool-expanded-panels">
      {openPanels.marks && <ToolMarksPanel line={line} />}
      {openPanels.arguments && line.argumentsText && (
        <div className="tui-tool-collapse-body">
          <pre className="tui-pre tui-tool-pre">{line.argumentsText}</pre>
        </div>
      )}
      {openPanels.output && line.outputText && (
        <div className="tui-tool-collapse-body">
          <pre className="tui-pre tui-tool-pre">{line.outputText}</pre>
        </div>
      )}
    </div>
  );
}

function ToolCardShell({ line, children, liveWindowIds }: {
  line: Extract<ChatLine, { kind: "tool" }>;
  children?: React.ReactNode;
  liveWindowIds?: Set<string>;
}) {
  // Issue #3 A5 fix: failed tool card 默认展开 + output 面板默认打开,
  // 让用户立即看到 error 文本而不是孤立的 `failed` 状态。仍可点击折叠回去。
  const isFailed = !line.pending && !line.ok;
  const [expanded, setExpanded] = useState(isFailed);
  const [openPanels, setOpenPanels] = useState<Record<ToolPanelKey, boolean>>({
    marks: false,
    arguments: false,
    output: isFailed,
  });
  const togglePanel = (panel: ToolPanelKey) => setOpenPanels((current) => ({ ...current, [panel]: !current[panel] }));
  const hasFooter = Boolean(line.marks?.length || line.argumentsText || line.outputText);
  const hasBody = Boolean(children || openPanels.marks || openPanels.arguments || openPanels.output);
  const ToolIcon = getToolIcon(line.toolName);
  // failed 状态下把 output 一句话摘要塞进 status pill 的 title attr, 让 hover 也能拿到 error
  const statusTitle = isFailed && line.outputText ? line.outputText.slice(0, 400) : undefined;

  return (
    <div className={`tui-tool-card tui-tool-card-${line.toolName}${isFailed ? " is-failed" : ""}`}>
      <div className="tui-tool-shell-head">
        <div className="tui-card-head tui-card-head-embedded tui-tool-card-head">
          <div className="tui-tool-head-row tui-tool-head-row-main">
            <span className="tui-prefix tui-prefix-icon">
              <ToolIcon size={12} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="tui-label">{line.toolName}</span>
            {line.title && <div className="tui-tool-title-main">{line.title}</div>}
            <div className="tui-tool-head-actions">
              {/* 把 link 按钮放在 head 行, 折叠时也能用 (用户反馈 2026-05-20). */}
              <WindowLinkInline line={line} liveWindowIds={liveWindowIds} />
              <span
                className={`tui-tool-status${line.pending ? " is-pending" : line.ok ? " is-success" : " is-fail"}`}
                title={statusTitle}
              >
                {line.pending ? "pending" : line.ok ? "ok" : "failed"}
              </span>
              <button
                type="button"
                className={`tui-tool-card-toggle${expanded ? " is-open" : ""}`}
                onClick={() => setExpanded((value) => !value)}
                title={expanded ? "收起 tool card" : "展开 tool card"}
                aria-label={expanded ? "收起 tool card" : "展开 tool card"}
              >
                <ChevronDown size={12} className="tui-tool-collapse-icon" />
              </button>
            </div>
          </div>
          {line.headerDescription && (
            <div className="tui-tool-head-row tui-tool-head-row-sub">
              <div className="tui-tool-title-sub">{line.headerDescription}</div>
            </div>
          )}
          {isFailed && !expanded && line.outputText && (
            <div className="tui-tool-head-row tui-tool-head-row-sub">
              <div className="tui-tool-fail-inline" title={line.outputText}>
                {line.outputText.split("\n")[0]?.slice(0, 200)}
              </div>
            </div>
          )}
        </div>
      </div>
      {expanded && hasBody && (
        <div className="tui-tool-body">
          {children}
          <ToolExpandedPanels line={line} openPanels={openPanels} />
        </div>
      )}
      {expanded && hasFooter && (
        <div className="tui-tool-footer">
          {line.marks?.length && <ToolFooterButton label="marks" open={openPanels.marks} onClick={() => togglePanel("marks")} />}
          {line.argumentsText && <ToolFooterButton label="arguments" open={openPanels.arguments} onClick={() => togglePanel("arguments")} />}
          {line.outputText && <ToolFooterButton label="output" open={openPanels.output} onClick={() => togglePanel("output")} />}
          <CopyBtn text={buildCopyText(line)} />
        </div>
      )}
    </div>
  );
}

function OpenToolCard({ line, liveWindowIds }: ToolCardShellProps) {
  return (
    <ToolCardShell line={line} liveWindowIds={liveWindowIds}>
      <ToolFieldList line={line} />
      {line.followUps && line.followUps.length > 0 && <ToolFollowUpsList line={line} />}
    </ToolCardShell>
  );
}

/**
 * 把跟在 open 后面、操作同一 window 的 refine/submit/close 显示为紧凑 step 行。
 * 节省纵向空间 + 让 form 的"open → fill → submit → close"全过程一眼可见。
 */
function ToolFollowUpsList({ line }: { line: Extract<ChatLine, { kind: "tool" }> }) {
  if (!line.followUps?.length) return null;
  return (
    <ul className="tui-tool-followups">
      {line.followUps.map((fu) => {
        const Icon = getToolIcon(fu.toolName);
        const status = fu.pending ? "pending" : fu.ok ? "ok" : "failed";
        return (
          <li key={fu.id} className={`tui-tool-followup tui-tool-followup-${fu.toolName} status-${status}`}>
            <span className="tui-tool-followup-icon">
              <Icon size={11} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="tui-tool-followup-name">{fu.toolName}</span>
            {fu.title && <span className="tui-tool-followup-title">{fu.title}</span>}
            {fu.headerDescription && (
              <span className="tui-tool-followup-desc" title={fu.headerDescription}>
                {fu.headerDescription}
              </span>
            )}
            <span
              className={`tui-tool-status${fu.pending ? " is-pending" : fu.ok ? " is-success" : " is-fail"}`}
              title={!fu.ok && !fu.pending && fu.outputText ? fu.outputText.slice(0, 400) : undefined}
            >
              {status}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function RefineToolCard({ line, liveWindowIds }: ToolCardShellProps) {
  return (
    <ToolCardShell line={line} liveWindowIds={liveWindowIds}>
      <ToolFieldList line={line} />
    </ToolCardShell>
  );
}

function SubmitToolCard({ line, liveWindowIds }: ToolCardShellProps) {
  return (
    <ToolCardShell line={line} liveWindowIds={liveWindowIds}>
      <ToolFieldList line={line} />
    </ToolCardShell>
  );
}

function CloseToolCard({ line, liveWindowIds }: ToolCardShellProps) {
  return (
    <ToolCardShell line={line} liveWindowIds={liveWindowIds}>
      <ToolFieldList line={line} />
    </ToolCardShell>
  );
}

function WaitToolCard({ line, liveWindowIds }: ToolCardShellProps) {
  return (
    <ToolCardShell line={line} liveWindowIds={liveWindowIds}>
      <ToolFieldList line={line} />
    </ToolCardShell>
  );
}

function GenericToolCard({ line, liveWindowIds }: ToolCardShellProps) {
  return <ToolCardShell line={line} liveWindowIds={liveWindowIds}><ToolFieldList line={line} /></ToolCardShell>;
}

type ToolCardShellProps = {
  line: Extract<ChatLine, { kind: "tool" }>;
  liveWindowIds?: Set<string>;
};

/**
 * 从 tool call 的 arguments / output 中提取要"跳转过去"的 window id。
 *
 * 各 tool 的语义:
 * - open      → output.form_id 是新建 window 的 id
 * - refine    → arguments.form_id 是被引用的 window
 * - submit    → arguments.form_id 是被提交的 command_exec window;
 *               output.window_id 才是用户实际想看的目标 sub-window(如 root.open_file → file_window)
 * - close     → arguments.window_id / form_id 是被关闭的 window
 * - wait      → arguments.on 通常是 window id
 *
 * 解析顺序:output 优先(执行结果),fallback 到 arguments(意图)。
 */
function extractTargetWindowId(line: Extract<ChatLine, { kind: "tool" }>): string | undefined {
  const out = coerceToObject(line.rawOutput);
  const args = coerceToObject(line.rawArguments);
  const fromOut = pickWindowIdField(out);
  if (fromOut) return fromOut;
  const fromArgs = pickWindowIdField(args);
  if (fromArgs) return fromArgs;
  if (args && typeof args.on === "string") return args.on;
  return undefined;
}

/** rawOutput/rawArguments 在 thread event 上是 JSON 字符串 (function_call_output.output 字段);
 * 历史路径有时已 parse 成 object. 这里两种都支持: 已是 object 直接返回, 是字符串就尝试 JSON.parse. */
function coerceToObject(v: unknown): Record<string, unknown> | undefined {
  if (isPlainObject(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    try {
      const parsed = JSON.parse(v);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function pickWindowIdField(obj: Record<string, unknown> | undefined): string | undefined {
  if (!obj) return undefined;
  for (const key of ["window_id", "form_id", "windowId", "formId"]) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Inline link button placed in tool card head.
 *
 * ooc-3: liveWindowIds is always an empty Set (no contextWindows protocol),
 * so this never renders a button — all window links are effectively dead.
 * Kept for structural compatibility; returns null when no live id is found.
 */
function WindowLinkInline({ line, liveWindowIds }: { line: Extract<ChatLine, { kind: "tool" }>; liveWindowIds?: Set<string> }) {
  const id = extractTargetWindowId(line);
  if (!id) return null;
  // ooc-3: liveWindowIds is always an empty Set → isLive always false → never render button
  const isLive = !liveWindowIds || liveWindowIds.has(id);
  if (!isLive) return null;
  return (
    <button
      type="button"
      className="tui-tool-window-link-btn tui-tool-window-link-inline"
      onClick={(e) => {
        e.stopPropagation();
        dispatchNavigateToWindow(id);
      }}
      title={`在 Context Tree 中定位 ${id}`}
      aria-label={`在 Context Tree 中定位 ${id}`}
    >
      <ExternalLink size={11} aria-hidden="true" />
    </button>
  );
}

function ToolCardRouter({ line, liveWindowIds }: ToolCardShellProps) {
  switch (line.toolName) {
    case "open":
      return <OpenToolCard line={line} liveWindowIds={liveWindowIds} />;
    case "refine":
      return <RefineToolCard line={line} liveWindowIds={liveWindowIds} />;
    case "submit":
      return <SubmitToolCard line={line} liveWindowIds={liveWindowIds} />;
    case "close":
      return <CloseToolCard line={line} liveWindowIds={liveWindowIds} />;
    case "wait":
      return <WaitToolCard line={line} liveWindowIds={liveWindowIds} />;
    default:
      return <GenericToolCard line={line} liveWindowIds={liveWindowIds} />;
  }
}

export function TuiBlock({ line, loading = false, liveWindowIds, sessionId, objectId, threadId }: { line: ChatLine; loading?: boolean; liveWindowIds?: Set<string>; sessionId?: string; objectId?: string; threadId?: string }) {
  const config = ROLE_CONFIG[line.role];
  const PrefixIcon = config.icon;
  // ooc-3 注入的 system context snapshot 体量很大，默认折叠避免淹没 timeline。
  const isSystemNotice = line.kind === "notice" && line.title === "system";
  const [noticeOpen, setNoticeOpen] = useState(!isSystemNotice);

  const renderHeader = (className = "tui-block-head", detail?: React.ReactNode, aside?: React.ReactNode, labelOverride?: string, showCopy = true, iconOverride?: LucideIcon) => {
    const HeaderIcon = iconOverride ?? PrefixIcon;
    return (
    <div className={className}>
      <span className={`tui-prefix${HeaderIcon ? " tui-prefix-icon" : ""}`}>
        {HeaderIcon ? <HeaderIcon size={12} strokeWidth={2} aria-hidden="true" /> : config.prefix}
      </span>
      <span className="tui-label">{labelOverride ?? config.label}</span>
      {detail && <div className="tui-header-detail">{detail}</div>}
      {loading && <Loader2 size={12} className="tui-spinner" />}
      {aside}
      {showCopy && <CopyBtn text={buildCopyText(line)} />}
    </div>
    );
  };

  const renderBody = () => {
    if (line.kind === "message") {
      // user/assistant role 决定头像/对齐;senderLabel(若有) 替换默认 label,
      // 让"通过 user 控制面回来的消息" vs "其它 object LLM 通过 talk 派来的消息" 在 UI 上能区分。
      const labelOverride = line.senderLabel;
      return (
        <>
          {renderHeader("tui-block-head", undefined, undefined, labelOverride)}
          <div className="tui-block-body">
            <InlineUiContent content={line.content} />
          </div>
        </>
      );
    }

    if (line.kind === "permission_card") {
      return (
        <PermissionCard
          line={line}
          sessionId={sessionId}
          objectId={objectId}
          threadId={threadId}
        />
      );
    }

    if (line.kind === "notice") {
      const toggle = isSystemNotice ? (
        <button
          type="button"
          className="tui-collapse-toggle"
          onClick={() => setNoticeOpen((v) => !v)}
          aria-expanded={noticeOpen}
        >
          {noticeOpen ? "收起" : "展开"}
        </button>
      ) : undefined;
      return (
        <div className={`tui-notice-card is-${line.tone ?? "info"}`}>
          <div className="tui-notice-card-head">
            {renderHeader("tui-card-head tui-card-head-embedded", <span className="tui-notice-title">{line.title}</span>, toggle)}
          </div>
          {noticeOpen && (
            <div className="tui-notice-body">
              <pre className="tui-pre tui-notice-pre">{line.content}</pre>
            </div>
          )}
        </div>
      );
    }

    return <ToolCardRouter line={line} liveWindowIds={liveWindowIds} />;
  };

  return (
    <div className={`tui-block ${config.className}`}>
      {renderBody()}
    </div>
  );
}

/**
 * permission_ask 决议卡 — chat 面板内联，单按钮「同意并继续」（拒绝路径走 LoopTimeline 决议层，
 * 不在 chat 面板暴露二级 UI）。decided 状态下按钮替换为静态徽章，pending 时点击调用
 * `decideChatPermission`，成功后由 polling 自动拉到下一份 thread context。
 */
function PermissionCard({
  line,
  sessionId,
  objectId,
  threadId,
}: {
  line: Extract<ChatLine, { kind: "permission_card" }>;
  sessionId?: string;
  objectId?: string;
  threadId?: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const decided = line.decided;

  const canDecide = !decided && Boolean(sessionId && objectId && threadId);
  async function handleApprove() {
    if (!sessionId || !objectId || !threadId) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await decideChatPermission({
        sessionId,
        objectId,
        threadId,
        toolCallId: line.toolCallId,
        action: "approve",
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="tui-notice-card tui-permission-card is-info" data-testid="permission-card">
      <div className="tui-notice-card-head">
        <span className="tui-prefix tui-prefix-icon">
          <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="tui-label">permission</span>
        <span className="tui-permission-title">需要授权才能继续</span>
      </div>
      <div className="tui-notice-body tui-permission-body">
        <dl className="tui-permission-meta">
          <dt>command</dt>
          <dd><code>{line.command}</code></dd>
          {line.argsSummary && (
            <>
              <dt>args</dt>
              <dd className="tui-permission-args">{line.argsSummary}</dd>
            </>
          )}
          {line.windowId && (
            <>
              <dt>window</dt>
              <dd><code>{line.windowId}</code></dd>
            </>
          )}
        </dl>
        {error && (
          <div className="error tui-permission-error" role="alert" data-testid="permission-card-error">
            决议失败: {error}
          </div>
        )}
        <div className="tui-permission-actions">
          {decided === "approve" && (
            <span className="tui-permission-badge is-approved" data-testid="permission-card-approved">
              ✓ 已同意
            </span>
          )}
          {decided === "reject" && (
            <span className="tui-permission-badge is-rejected" data-testid="permission-card-rejected">
              已拒绝
            </span>
          )}
          {!decided && (
            <button
              type="button"
              className="btn small primary tui-permission-approve"
              disabled={submitting || !canDecide}
              onClick={() => void handleApprove()}
              data-testid="permission-card-approve"
              title={canDecide ? "同意并继续" : "缺少 session/thread 上下文,无法决议"}
            >
              {submitting ? "处理中…" : "同意并继续"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
