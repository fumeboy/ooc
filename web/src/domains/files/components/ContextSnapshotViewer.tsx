/**
 * ContextSnapshotViewer — 渲染 thread 的 ContextSnapshot（结构化版本）。
 *
 * 复用 LLMInputJsonViewer 的左树 + 右详情 + llm-input-* 样式，
 * 但完全不依赖 XML 解析，节点直接来自 src/domains/files/context-snapshot.ts。
 *
 * 两处使用：
 * 1) FileViewer 在已选 session 但未选文件时，直接展示 thread 的 context（来自 thread API）
 * 2) LLMInputJsonViewer 在新版 llm.input.json（含 contextSnapshot 字段）中，把 system message
 *    XML 子树替换为本组件
 */

import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  ChevronRight,
  CircleDot,
  FileCheck,
  FileText,
  Inbox,
  Layers,
  ListChecks,
  Loader2,
  Mail,
  MessageSquare,
  PanelTop,
  Play,
  ScrollText,
  Send,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import {
  buildContextTree,
  collectAllNodeIds,
  estimateTokens,
  flattenContextTree,
  type ContextNode,
  type ContextSnapshot,
  type ContextWindow,
  type TranscriptEntry,
} from "../context-snapshot";

function previewText(value: string, limit = 88): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (!singleLine) return "(empty)";
  if (singleLine.length <= limit) return singleLine;
  return `${singleLine.slice(0, limit)}…`;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const WINDOW_TYPE_ICON: Record<ContextWindow["type"], LucideIcon> = {
  root: PanelTop,
  command_exec: FileCheck,
  do: Inbox,
  todo: ListChecks,
  talk: MessageSquare,
  program: Play,
  file: FileText,
  knowledge: ScrollText,
};

/** 把节点状态映射成颜色基调；节点没有 status 时返回 "neutral"。 */
type Tone = "info" | "warning" | "success" | "error" | "neutral";
function statusToTone(status?: string): Tone {
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
      return "neutral";
  }
}

/** 根据 ContextNode 的 data 派生 (icon, tone, status)。 */
function nodeAffix(node: ContextNode): { icon: LucideIcon; tone: Tone; status?: string } {
  switch (node.data.kind) {
    case "thread":
      return { icon: Layers, tone: statusToTone(node.data.snapshot.status), status: node.data.snapshot.status };
    case "section": {
      const sectionIcon: Record<string, LucideIcon> = {
        plan: Bell,
        contextWindows: Layers,
        inbox: Inbox,
        outbox: Send,
        events: Terminal,
      };
      return { icon: sectionIcon[node.data.section] ?? CircleDot, tone: "neutral" };
    }
    case "window": {
      const w = node.data.window;
      return { icon: WINDOW_TYPE_ICON[w.type], tone: statusToTone(w.status), status: w.status };
    }
    case "message":
      return { icon: Mail, tone: "neutral" };
    case "exec":
      return { icon: Terminal, tone: node.data.exec.ok ? "success" : "error", status: node.data.exec.ok ? "ok" : "fail" };
    case "event":
      return { icon: Bell, tone: "neutral" };
  }
}

/** 复用 cw-* 样式做美化的左树行。 */
function TreeNode({
  node,
  selectedId,
  expanded,
  onSelect,
  onToggle,
}: {
  node: ContextNode;
  selectedId: string | null;
  expanded: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const isSelected = selectedId === node.id;
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const { icon: Icon, tone, status } = nodeAffix(node);
  const isExecuting = node.data.kind === "window" && node.data.window.type === "command_exec" && node.data.window.status === "executing";

  return (
    <li>
      <div
        className={`cw-row cw-tone-${tone}${isSelected ? " is-selected" : ""}`}
        style={{ paddingLeft: `${node.depth * 14 + 6}px` }}
        onClick={() => onSelect(node.id)}
      >
        <button
          type="button"
          className="cw-chevron-btn"
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggle(node.id);
          }}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            <ChevronRight size={12} className={isExpanded ? "cw-chevron-open" : ""} aria-hidden="true" />
          ) : (
            <CircleDot size={9} aria-hidden="true" />
          )}
        </button>
        <Icon size={13} aria-hidden="true" className="cw-row-icon" />
        <div className="cw-row-content">
          <div className="cw-row-head">
            <span className="cw-row-label">{node.label}</span>
            {node.badge && <span className="cw-row-badge">{node.badge}</span>}
            {status && <span className={`cw-status cw-status-${tone}`}>{status}</span>}
            {isExecuting && <Loader2 size={11} className="cw-spinner" aria-hidden="true" />}
          </div>
          {node.summary && <div className="cw-row-summary">{node.summary}</div>}
        </div>
        {node.messageCounts ? (
          <div className="cw-row-msg-counts" aria-label={`inbox ${node.messageCounts.inbox}, outbox ${node.messageCounts.outbox}`}>
            <span className="cw-row-msg-count cw-row-msg-count-inbox">
              <ArrowRight size={11} aria-hidden="true" />
              <span className="cw-row-msg-count-num">{node.messageCounts.inbox}</span>
            </span>
            <span className="cw-row-msg-count cw-row-msg-count-outbox">
              <ArrowLeft size={11} aria-hidden="true" />
              <span className="cw-row-msg-count-num">{node.messageCounts.outbox}</span>
            </span>
          </div>
        ) : (
          <span className="cw-row-size">{node.charCount}</span>
        )}
      </div>
      {hasChildren && isExpanded && (
        <ul className="cw-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * 内联 talk-window 回复 composer。
 *
 * 仅在 talk window 的 caller 或 callee 含 user 时显示：
 * - selfObjectId === "user"：当前 thread 是 user 的（caller 是 user）
 * - window.target === "user"：对方是 user（callee 是 user）
 *
 * 发送走外层 onUserReply（由 shell 注入，最终调 continueThread）。
 */
function InlineTalkComposer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const cannotSend = disabled || busy || !text.trim();
  return (
    <div className="llm-input-talk-composer">
      <textarea
        className="llm-input-talk-composer-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="以 user 身份回复…"
        disabled={disabled || busy}
        rows={2}
      />
      <button
        type="button"
        className="llm-input-talk-composer-btn"
        disabled={cannotSend}
        onClick={async () => {
          if (cannotSend) return;
          setBusy(true);
          try {
            await onSend(text);
            setText("");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Sending…" : "Send"}
      </button>
    </div>
  );
}

/** Window 详情：按 type narrow 渲染特定字段；通用字段（id/title/status）始终渲染。 */
function WindowDetail({
  window,
  transcript,
  selfObjectId,
  onUserReply,
}: {
  window: ContextWindow;
  transcript?: TranscriptEntry[];
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
}) {
  const rows: Array<[string, string]> = [
    ["id", window.id],
    ["type", window.type],
    ["title", window.title],
    ["status", String(window.status ?? "")],
  ];
  if (window.type !== "root" && window.parentWindowId) {
    rows.push(["parent", window.parentWindowId]);
  }
  return (
    <div className="llm-input-detail-body">
      <div className="llm-input-detail-header">
        <div>
          <div className="llm-input-detail-title">{window.type} window · {window.title}</div>
          <div className="llm-input-detail-meta">{window.id}</div>
        </div>
      </div>
      <div className="llm-input-attrs">
        {rows.map(([k, v]) => (
          <div key={k} className="llm-input-attr-row">
            <span className="llm-input-attr-key">{k}</span>
            <span className="llm-input-attr-value">{v}</span>
          </div>
        ))}
      </div>
      {window.type === "command_exec" && (
        <>
          <div className="llm-input-attrs">
            <div className="llm-input-attr-row">
              <span className="llm-input-attr-key">command</span>
              <span className="llm-input-attr-value">{window.command}</span>
            </div>
            {window.description && (
              <div className="llm-input-attr-row">
                <span className="llm-input-attr-key">description</span>
                <span className="llm-input-attr-value">{window.description}</span>
              </div>
            )}
            {window.commandPaths && window.commandPaths.length > 0 && (
              <div className="llm-input-attr-row">
                <span className="llm-input-attr-key">paths</span>
                <span className="llm-input-attr-value">{window.commandPaths.join(", ")}</span>
              </div>
            )}
          </div>
          {window.accumulatedArgs && Object.keys(window.accumulatedArgs).length > 0 && (
            <CodeMirror
              className="code-editor is-readonly"
              value={formatJson(window.accumulatedArgs)}
              editable={false}
              extensions={[jsonLanguage()]}
              basicSetup={{ lineNumbers: false, foldGutter: true }}
            />
          )}
          {window.status === "executed" && window.result && (
            <pre className="llm-input-pre">{window.result}</pre>
          )}
        </>
      )}
      {window.type === "do" && (
        <div className="llm-input-attrs">
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">target_thread</span>
            <span className="llm-input-attr-value">{window.targetThreadId}</span>
          </div>
          {window.isCreatorWindow && (
            <div className="llm-input-attr-row">
              <span className="llm-input-attr-key">role</span>
              <span className="llm-input-attr-value">creator window（不可关闭）</span>
            </div>
          )}
        </div>
      )}
      {window.type === "todo" && (
        <>
          <pre className="llm-input-pre">{window.content}</pre>
          {window.onCommandPath && window.onCommandPath.length > 0 && (
            <div className="llm-input-attr-row">
              <span className="llm-input-attr-key">on_command_path</span>
              <span className="llm-input-attr-value">{window.onCommandPath.join(", ")}</span>
            </div>
          )}
        </>
      )}
      {window.type === "talk" && (
        <div className="llm-input-attrs">
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">target</span>
            <span className="llm-input-attr-value">{window.target}</span>
          </div>
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">conversation</span>
            <span className="llm-input-attr-value">{window.conversationId}</span>
          </div>
        </div>
      )}
      {window.type === "program" && (
        <div className="llm-input-attrs">
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">execs</span>
            <span className="llm-input-attr-value">{window.history.length}</span>
          </div>
        </div>
      )}
      {window.type === "file" && (
        <div className="llm-input-attrs">
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">path</span>
            <span className="llm-input-attr-value">{window.path}</span>
          </div>
          {window.lines && (
            <div className="llm-input-attr-row">
              <span className="llm-input-attr-key">lines</span>
              <span className="llm-input-attr-value">{window.lines.join("-")}</span>
            </div>
          )}
          {window.columns && (
            <div className="llm-input-attr-row">
              <span className="llm-input-attr-key">columns</span>
              <span className="llm-input-attr-value">{window.columns.join("-")}</span>
            </div>
          )}
        </div>
      )}
      {window.type === "knowledge" && (
        <>
          <div className="llm-input-attrs">
            <div className="llm-input-attr-row">
              <span className="llm-input-attr-key">path</span>
              <span className="llm-input-attr-value">{window.path}</span>
            </div>
            {window.source && (
              <div className="llm-input-attr-row">
                <span className="llm-input-attr-key">source</span>
                <span className="llm-input-attr-value">{window.source}</span>
              </div>
            )}
            {window.presentation && (
              <div className="llm-input-attr-row">
                <span className="llm-input-attr-key">presentation</span>
                <span className="llm-input-attr-value">{window.presentation}</span>
              </div>
            )}
            {window.description && (
              <div className="llm-input-attr-row">
                <span className="llm-input-attr-key">description</span>
                <span className="llm-input-attr-value">{window.description}</span>
              </div>
            )}
          </div>
          {window.body && <pre className="llm-input-pre">{window.body}</pre>}
        </>
      )}
      {transcript && transcript.length > 0 && (
        <div className="llm-input-transcript">
          <div className="llm-input-transcript-head">transcript · {transcript.length} message{transcript.length === 1 ? "" : "s"}</div>
          <ul className="llm-input-transcript-list">
            {transcript.map((entry, idx) => {
              const m = entry.message;
              const dir = entry.channel === "inbox"
                ? `← ${m.fromThreadId ?? "?"}`
                : `→ ${m.toThreadId ?? "?"}`;
              return (
                <li key={m.id ?? idx} className={`llm-input-transcript-item llm-input-transcript-item-${entry.channel}`}>
                  <div className="llm-input-transcript-meta">
                    <span className="llm-input-transcript-index">[#{idx}]</span>
                    <span className="llm-input-transcript-dir">{dir}</span>
                    {m.source && <span className="llm-input-transcript-source">{m.source}</span>}
                  </div>
                  <pre className="llm-input-transcript-content">{m.content ?? ""}</pre>
                </li>
              );
            })}
          </ul>
          {window.type === "talk" && onUserReply && (selfObjectId === "user" || window.target === "user") && (
            <InlineTalkComposer onSend={onUserReply} />
          )}
        </div>
      )}
      {window.type === "talk" && onUserReply && (selfObjectId === "user" || window.target === "user") && (!transcript || transcript.length === 0) && (
        <div className="llm-input-transcript">
          <InlineTalkComposer onSend={onUserReply} />
        </div>
      )}
    </div>
  );
}

/** 详情面板：按 ContextNode.data.kind 走分支。 */
function NodeDetail({
  node,
  selfObjectId,
  onUserReply,
}: {
  node: ContextNode | null;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
}) {
  if (!node) return <div className="llm-input-empty">选择左侧节点查看详情。</div>;
  const data = node.data;

  if (data.kind === "thread") {
    const s = data.snapshot;
    return (
      <div className="llm-input-detail-body">
        <div className="llm-input-detail-header">
          <div>
            <div className="llm-input-detail-title">Thread {s.id}</div>
            <div className="llm-input-detail-meta">
              status: {s.status ?? "?"}
              {s.creatorThreadId ? ` · creator: ${s.creatorThreadId}` : ""}
              {s.parentThreadId ? ` · parent: ${s.parentThreadId}` : ""}
            </div>
          </div>
        </div>
        <div className="llm-input-attrs">
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">windows</span>
            <span className="llm-input-attr-value">{s.contextWindows?.length ?? 0}</span>
          </div>
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">inbox</span>
            <span className="llm-input-attr-value">{s.inbox?.length ?? 0}</span>
          </div>
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">outbox</span>
            <span className="llm-input-attr-value">{s.outbox?.length ?? 0}</span>
          </div>
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">events</span>
            <span className="llm-input-attr-value">{s.events?.length ?? 0}</span>
          </div>
        </div>
      </div>
    );
  }

  if (data.kind === "section") {
    if (data.section === "plan") {
      return (
        <div className="llm-input-detail-body">
          <div className="llm-input-detail-header">
            <div>
              <div className="llm-input-detail-title">plan</div>
              <div className="llm-input-detail-meta">{node.charCount} chars · ~{estimateTokens(node.charCount)} tokens</div>
            </div>
          </div>
          <pre className="llm-input-pre">{node.summary}</pre>
        </div>
      );
    }
    return (
      <div className="llm-input-detail-body">
        <div className="llm-input-detail-header">
          <div>
            <div className="llm-input-detail-title">{node.label}</div>
            <div className="llm-input-detail-meta">{node.children.length} item{node.children.length === 1 ? "" : "s"} · {node.charCount} chars</div>
          </div>
        </div>
        {node.children.length === 0 && <div className="llm-input-empty">该 section 当前为空。</div>}
        {node.children.length > 0 && <div className="llm-input-empty">展开左侧条目查看详情。</div>}
      </div>
    );
  }

  if (data.kind === "window") {
    return <WindowDetail window={data.window} transcript={data.transcript} selfObjectId={selfObjectId} onUserReply={onUserReply} />;
  }

  if (data.kind === "message") {
    const m = data.message;
    return (
      <div className="llm-input-detail-body">
        <div className="llm-input-detail-header">
          <div>
            <div className="llm-input-detail-title">{data.channel} message</div>
            <div className="llm-input-detail-meta">
              from: {m.fromThreadId ?? "?"} → to: {m.toThreadId ?? "?"}
              {m.source ? ` · ${m.source}` : ""}
              {m.windowId ? ` · window=${m.windowId}` : ""}
              {m.replyToWindowId ? ` · replyTo=${m.replyToWindowId}` : ""}
            </div>
          </div>
        </div>
        <pre className="llm-input-pre">{m.content ?? ""}</pre>
      </div>
    );
  }

  if (data.kind === "exec") {
    const e = data.exec;
    return (
      <div className="llm-input-detail-body">
        <div className="llm-input-detail-header">
          <div>
            <div className="llm-input-detail-title">exec · {e.language}</div>
            <div className="llm-input-detail-meta">
              {e.execId} · {e.ok ? "ok" : "fail"} · {new Date(e.startedAt).toLocaleString()}
            </div>
          </div>
        </div>
        {e.code && (
          <CodeMirror
            className="code-editor is-readonly"
            value={e.code}
            editable={false}
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        )}
        {e.function && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">function</span>
            <span className="llm-input-attr-value">{e.function}</span>
          </div>
        )}
        {e.args !== undefined && (
          <CodeMirror
            className="code-editor is-readonly"
            value={formatJson(e.args)}
            editable={false}
            extensions={[jsonLanguage()]}
            basicSetup={{ lineNumbers: false, foldGutter: true }}
          />
        )}
        <pre className="llm-input-pre">{e.output}</pre>
      </div>
    );
  }

  if (data.kind === "event") {
    return (
      <div className="llm-input-detail-body">
        <div className="llm-input-detail-header">
          <div>
            <div className="llm-input-detail-title">event #{data.index}</div>
            <div className="llm-input-detail-meta">{previewText(node.label)}</div>
          </div>
        </div>
        <CodeMirror
          className="code-editor is-readonly"
          value={formatJson(data.event)}
          editable={false}
          extensions={[jsonLanguage()]}
          basicSetup={{ lineNumbers: true, foldGutter: true }}
        />
      </div>
    );
  }

  return <div className="llm-input-empty">未知节点类型。</div>;
}

/**
 * ContextSnapshotViewer —— 接受一份结构化 ContextSnapshot，渲染左树 + 右详情。
 *
 * 没有 toolbar header（与 LLMInputJsonViewer 相比更紧凑），方便嵌入到 FileViewer
 * 或 LLMInputJsonViewer 的某个 input item 详情区。
 */
export function ContextSnapshotViewer({
  snapshot,
  selfObjectId,
  onUserReply,
}: {
  snapshot: ContextSnapshot;
  /** 当前 thread 的 self objectId；用于决定 talk window 的 user 端 composer 是否要显示。 */
  selfObjectId?: string;
  /** 用户以 user 身份回复 talk window 时的发送回调；缺省时不显示 composer。 */
  onUserReply?: (text: string) => Promise<void>;
}) {
  const tree = useMemo(() => buildContextTree(snapshot), [snapshot]);
  const treeMap = useMemo(() => flattenContextTree(tree), [tree]);
  const [selectedKey, setSelectedKey] = useState<string | null>(tree.id);
  const [expanded, setExpanded] = useState<Set<string>>(() => collectAllNodeIds(tree));

  useEffect(() => {
    setSelectedKey(tree.id);
    setExpanded(collectAllNodeIds(tree));
  }, [tree]);

  const selectedNode = selectedKey ? treeMap.get(selectedKey) ?? null : null;
  const totalChars = tree.charCount;

  return (
    <div className="llm-input-viewer">
      <div className="llm-input-header">
        <div>
          <div className="llm-input-title">Thread Context</div>
          <div className="llm-input-subtitle">thread: {snapshot.id}</div>
        </div>
        <div className="llm-input-stats">
          {snapshot.status && <span className="pill">{snapshot.status}</span>}
          <span className="pill">{snapshot.contextWindows?.length ?? 0} windows</span>
          <span className="pill">{snapshot.events?.length ?? 0} events</span>
          <span className="pill">~{estimateTokens(totalChars)} tokens</span>
        </div>
      </div>
      <div className="llm-input-layout">
        <aside className="llm-input-items">
          <div className="llm-input-sidebar-title">context tree</div>
          <ul className="cw-children llm-input-item-list">
            <TreeNode
              node={tree}
              selectedId={selectedKey}
              expanded={expanded}
              onSelect={setSelectedKey}
              onToggle={(id) => {
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
            />
          </ul>
        </aside>
        <section className="llm-input-main">
          <NodeDetail node={selectedNode} selfObjectId={selfObjectId} onUserReply={onUserReply} />
        </section>
      </div>
    </div>
  );
}
