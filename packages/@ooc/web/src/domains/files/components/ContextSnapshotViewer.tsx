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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDot,
  ClipboardList,
  ExternalLink,
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
  Puzzle,
  ScrollText,
  Search,
  Send,
  Sparkles,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  buildContextTree,
  collectInitialExpandedIds,
  estimateTokens,
  findNodePath,
  flattenContextTree,
  type ContextNode,
  type ContextSnapshot,
  type ContextWindow,
  type TranscriptEntry,
} from "../context-snapshot";
import { subscribeNavigateToWindow } from "../navigation-events";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { useDisplayName, useObjectTypes } from "../../objects";
import {
  formatJson,
  previewText,
  statusToTone,
  type Tone,
} from "@ooc/builtins/_shared/visible/utils";
import { WindowVisible } from "./visible/resolveWindowVisible";

const WINDOW_TYPE_ICON: Partial<Record<string, LucideIcon>> = {
  root: PanelTop,
  method_exec: FileCheck,
  form_guidance: FileCheck,
  do: Inbox,
  todo: ListChecks,
  talk: MessageSquare,
  program: Play,
  file: FileText,
  knowledge: ScrollText,
  search: Search,
  relation: Users,
  skill_index: Sparkles,
  feishu_chat: MessageSquare,
  feishu_doc: FileText,
  plan: ClipboardList,
};

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
    case "windowGroup":
      return { icon: WINDOW_TYPE_ICON[node.data.windowType] ?? CircleDot, tone: "neutral" };
    case "window": {
      const w = node.data.window;
      return { icon: WINDOW_TYPE_ICON[w.type] ?? CircleDot, tone: statusToTone(w.status), status: w.status };
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
/**
 * 复用 cw-* 样式做美化的左树行。
 *
 * 性能:用 React.memo + 自定义 areEqual,只比较真正影响该行 DOM 输出的字段。
 * polling 刷新时 buildContextTree 会重建整棵树(node 引用都变了),但只要某行的
 * 可见字段没变就 short-circuit,避免长 events / 多 window 列表全量 re-render。
 *
 * 同时把 selectedId/expanded 整个 Set 传入子组件(而非 boolean),让递归子节点
 * 能继续自己判断 — 这意味着 areEqual 必须比较 selectedId 是否仍命中 self 或某个
 * descendant、expanded 集合是否含本节点。出于实用考虑,我们只比较"本行需要的":
 * self.id === selectedId 与 expanded.has(node.id);递归 children 由 React 自行
 * 沿组件树重新检查(每一层都会跑 memo 比较)。
 */
function TreeNodeImpl({
  node,
  selectedId,
  expanded,
  onSelect,
  onToggle,
  depthOffset = 0,
}: {
  node: ContextNode;
  selectedId: string | null;
  expanded: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  /** 渲染时把 node.depth 减去这个偏移,用来支持"隐藏根节点,从 children 起当作 depth=0"。 */
  depthOffset?: number;
}) {
  const isSelected = selectedId === node.id;
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const { icon: Icon, tone, status } = nodeAffix(node);
  const isExecuting = node.data.kind === "window" && node.data.window.type === "method_exec" && node.data.window.status === "executing";
  const renderDepth = Math.max(0, node.depth - depthOffset);

  return (
    <li>
      <div
        className={`cw-row cw-tone-${tone}${isSelected ? " is-selected" : ""}`}
        style={{ paddingLeft: `${renderDepth * 14 + 6}px` }}
        data-cw-node-id={node.id}
        aria-selected={isSelected}
        onClick={() => {
          onSelect(node.id);
          // 点击行也切换展开 — 用户反馈 2026-05-20:
          // 此前只能点 chevron 才能折叠/展开, 误点行只 select 不 toggle 让用户以为"展开后无法收起"
          if (hasChildren) onToggle(node.id);
        }}
      >
        <button
          type="button"
          className="cw-chevron-btn"
          onClick={(event) => {
            // 让事件冒泡到 row 触发 select+toggle, 避免两次切换
            event.stopPropagation();
            onSelect(node.id);
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
              depthOffset={depthOffset}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * TreeNode 的 memo wrapper。
 *
 * 关键约束(2026-05-21 修复后):memo 不能"只看本行 expanded.has(self.id)" —— 因为如果父
 * 节点 memo 跳过 re-render,React 会重用整棵子树的旧 element,descendant memo 根本不会跑。
 * 用户在深层 window 行触发 toggle 时,中间的 section 节点 expanded 位没变,会被旧逻辑误判
 * 为"等同 → skip",于是被切换那一行永远拿不到新的 expanded 集 —— 视觉上表现为"无法折叠"。
 *
 * 现在的策略:expanded 用引用比较。
 * - 没有 toggle 发生时(polling 刷新 events),useEffect 里的 filter 检测到 size 不变会返回
 *   原引用,memo 仍然能 short-circuit。
 * - 一旦 toggle/Navigate-to 改了 set,引用变化会沿整棵树打穿 memo —— 这是必须的,因为我们
 *   不知道是哪一层 descendant 翻了位。
 */
const TreeNode = memo(TreeNodeImpl, (prev, next) => {
  if (prev.depthOffset !== next.depthOffset) return false;
  if (prev.onSelect !== next.onSelect || prev.onToggle !== next.onToggle) return false;
  // expanded set 引用变化 = 用户切了某行 expand 状态;不知道改的是不是 descendant,必须 re-render
  if (prev.expanded !== next.expanded) return false;
  const a = prev.node;
  const b = next.node;
  if (a === b) {
    // 同 node ref + expanded 引用相同 → 只剩 selectedId 可能影响本行
    return (
      prev.selectedId === next.selectedId ||
      (prev.selectedId !== a.id && next.selectedId !== a.id)
    );
  }
  // 不同引用:逐字段比较"可见输出"
  if (
    a.id !== b.id ||
    a.label !== b.label ||
    a.summary !== b.summary ||
    a.charCount !== b.charCount ||
    a.badge !== b.badge ||
    a.depth !== b.depth
  ) {
    return false;
  }
  // messageCounts 字段比较
  const am = a.messageCounts;
  const bm = b.messageCounts;
  if (am !== bm) {
    if (!am || !bm) return false;
    if (am.inbox !== bm.inbox || am.outbox !== bm.outbox) return false;
  }
  // children 轻量 fingerprint:数量 + 首尾 id;够用,因为顺序由 buildContextTree 决定
  if (a.children.length !== b.children.length) return false;
  if (a.children.length > 0) {
    if (a.children[0]!.id !== b.children[0]!.id) return false;
    const last = a.children.length - 1;
    if (a.children[last]!.id !== b.children[last]!.id) return false;
  }
  // 选中/展开:仅本行命中或脱离命中才需要 re-render
  if ((prev.selectedId === a.id) !== (next.selectedId === b.id)) return false;
  return true;
});

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

/**
 * Window 上可用的 command 清单(chips)。catalog 来自 `/api/objects/_shared/types`,缓存在
 * useObjectTypes 内,不随 thread polling 重拉。空数组(如 todo)隐藏整段;catalog
 * 还没到位先不渲染,避免 "0 commands" 闪烁。
 *
 * Hover chip 时弹一个 markdown tooltip 展示 command 描述(取自后端 *_BASIC 路径,
 * 通常 200~1500 字符)。无 description 的 chip 退化成只显示名字。
 */
function WindowCommandsChips({ type }: { type: string }) {
  const catalog = useObjectTypes();
  const entry = catalog?.[type];
  if (!entry || entry.methods.length === 0) return null;
  // 历史上这里有一行 hint："commands open(parent_window_id=..., command=..., args={...})"
  // 用户反馈：对真实使用是噪声（chips 已自带名字，hover 看 description 即可）。去掉。
  return (
    <div className="llm-input-commands">
      <div className="llm-input-commands-chips">
        {entry.methods.map((cmd) => (
          <span key={cmd.name} className="llm-input-command-chip" tabIndex={0}>
            {cmd.name}
            {cmd.description && (
              <span className="llm-input-command-tip" role="tooltip">
                <MarkdownContent content={cmd.description} />
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Window 详情：按 type narrow 渲染特定字段；通用字段（id/title/status）始终渲染。 */
/** 未知 / 无 visible 的 window 兜底：整个对象按 JSON 只读显示。
 *  从原 WindowDetail 内联 JSON 块抽出，作为 WindowVisible 的 jsonFallback。 */
function JsonFallback({ window }: { window: ContextWindow }) {
  return (
    <CodeMirror
      className="code-editor is-readonly"
      value={formatJson(window)}
      editable={false}
      extensions={[jsonLanguage()]}
      basicSetup={{ lineNumbers: false, foldGutter: true }}
    />
  );
}

function WindowDetail({
  window,
  transcript,
  selfObjectId,
  onUserReply,
  sessionId,
}: {
  window: ContextWindow;
  transcript?: TranscriptEntry[];
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
  /** 线 A：透传给 WindowVisible，用于 user-defined object visible 的 stone worktree 路由（可选）。 */
  sessionId?: string;
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
            <WindowCommandsChips type={window.type} />
      <div className="llm-input-attrs">
        {rows.map(([k, v]) => (
          <div key={k} className="llm-input-attr-row">
            <span className="llm-input-attr-key">{k}</span>
            <span className="llm-input-attr-value">{v}</span>
          </div>
        ))}
      </div>
      {/* 线 A：统一 window 视觉渲染解析层。builtin 走静态注册表，user-defined object 走
          运行时动态加载（自己写的 visible），都没有则 JSON 兜底。详见
          ./visible/resolveWindowVisible.tsx。原 per-type switch + HANDLED_WINDOW_TYPES 已删除。 */}
      <WindowVisible window={window} jsonFallback={JsonFallback} sessionId={sessionId} />
      {transcript && transcript.length > 0 && (
        <div className="llm-input-transcript">
          <div className="llm-input-transcript-head">transcript · {transcript.length} message{transcript.length === 1 ? "" : "s"}</div>
          <ul className="llm-input-transcript-list">
            {transcript.map((entry, idx) => {
              const m = entry.message;
              // 把 fromThreadId / toThreadId 与可选的 fromObjectId 一起渲染,
              // 让 transcript 中既能看到对端 thread id(精确定位)又能看到 object id(语义)
              const dir = entry.channel === "inbox"
                ? `← ${m.fromObjectId ? `${m.fromObjectId} · ` : ""}${m.fromThreadId ?? "?"}`
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
          {/*
            InlineTalkComposer 仅在 selfObjectId === "user" 时显示。
            原条件 (window.target === "user") 在对端(如 critic)的 talk window 视图也会激活,
            但发送走 handleSend → continueThread,后端永远从 user.root.talk_window[0] 派送,
            目标是该 talk_window 的对端(通常 = supervisor),并不会回到当前 critic thread。
            结果是"用户在 critic 视图发了消息,自己视图看不到,切回对端才看到"——非常误导。
            修复:严格只在 user.root 自己的 thread 视图里允许内联回复。
          */}
          {window.type === "talk" && onUserReply && selfObjectId === "user" && (
            <InlineTalkComposer onSend={onUserReply} />
          )}
        </div>
      )}
      {window.type === "talk" && onUserReply && selfObjectId === "user" && (!transcript || transcript.length === 0) && (
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
  sessionId,
}: {
  node: ContextNode | null;
  selfObjectId?: string;
  onUserReply?: (text: string) => Promise<void>;
  sessionId?: string;
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
    return <WindowDetail window={data.window} transcript={data.transcript} selfObjectId={selfObjectId} onUserReply={onUserReply} sessionId={sessionId} />;
  }

  if (data.kind === "windowGroup") {
    return (
      <div className="llm-input-detail-body">
        <div className="llm-input-detail-header">
          <div>
            <div className="llm-input-detail-title">{data.windowType} windows</div>
            <div className="llm-input-detail-meta">
              {node.children.length} window{node.children.length === 1 ? "" : "s"} · {node.charCount} chars
            </div>
          </div>
        </div>
        <div className="llm-input-empty">展开左侧条目查看单个 window 详情。</div>
      </div>
    );
  }

  if (data.kind === "message") {
    const m = data.message;
    const fromLabel = m.fromObjectId ? `${m.fromObjectId} · ${m.fromThreadId ?? "?"}` : (m.fromThreadId ?? "?");
    return (
      <div className="llm-input-detail-body">
        <div className="llm-input-detail-header">
          <div>
            <div className="llm-input-detail-title">{data.channel} message</div>
            <div className="llm-input-detail-meta">
              from: {fromLabel} → to: {m.toThreadId ?? "?"}
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
  sessionId,
}: {
  snapshot: ContextSnapshot;
  /** 当前 thread 的 self objectId；用于决定 talk window 的 user 端 composer 是否要显示。 */
  selfObjectId?: string;
  /** 用户以 user 身份回复 talk window 时的发送回调；缺省时不显示 composer。 */
  onUserReply?: (text: string) => Promise<void>;
  /** 线 A：当前 session（flow）id，透传给 WindowVisible 做 user-defined object visible 的
   *  stone worktree 路由（可选；拿不到则读 committed visible）。 */
  sessionId?: string;
}) {
  const tree = useMemo(() => buildContextTree(snapshot), [snapshot]);
  const treeMap = useMemo(() => flattenContextTree(tree), [tree]);
  // 默认选中第一个子节点(隐藏 thread 根节点后,根节点对用户不可见,不应作为默认选中)。
  const defaultSelected = tree.children[0]?.id ?? tree.id;
  const [selectedKey, setSelectedKey] = useState<string | null>(defaultSelected);
  const [expanded, setExpanded] = useState<Set<string>>(() => collectInitialExpandedIds(tree));

  // 跨 snapshot 保留用户态:只在 thread.id 切换(用户切到不同 thread)时重置;
  // 同 thread 内的 polling 刷新(events 增长等)保留 selection / expand 集。
  // 新增节点(如新 talk_window 派生的 relation knowledge)默认折叠 — 用户没主动
  // 展开过的就不展开,与"events 默认折叠"哲学一致;避免新内容跳出来分散注意力。
  const threadIdRef = useRef(snapshot.id);
  useEffect(() => {
    if (threadIdRef.current !== snapshot.id) {
      threadIdRef.current = snapshot.id;
      setSelectedKey(tree.children[0]?.id ?? tree.id);
      setExpanded(collectInitialExpandedIds(tree));
    } else {
      // 同 thread 内的更新:剔除掉树里已经不存在的 id(避免 expanded set 无限膨胀);
      // 选中节点若被移除则 fallback 到第一个 child
      setExpanded((prev) => {
        const next = new Set<string>();
        for (const id of prev) if (treeMap.has(id)) next.add(id);
        return next.size === prev.size ? prev : next;
      });
      setSelectedKey((prev) => (prev && treeMap.has(prev) ? prev : tree.children[0]?.id ?? tree.id));
    }
  }, [tree, treeMap, snapshot.id]);

  // 跨组件导航:外部 dispatchNavigateToWindow(id) 时,定位到该 window 节点。
  // 候选 id 形式 "window:<id>"(buildWindowNode 使用的 id pattern);兼容传入裸 window id。
  useEffect(() => {
    return subscribeNavigateToWindow(({ windowId }) => {
      const candidates = [windowId, `window:${windowId}`];
      const hit = candidates.find((c) => treeMap.has(c));
      if (!hit) return;
      const path = findNodePath(tree, hit);
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const node of path) next.add(node.id);
        return next;
      });
      setSelectedKey(hit);
      // 滚动到目标行(用 row id 选择器)
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-cw-node-id="${CSS.escape(hit)}"]`);
        if (el && "scrollIntoView" in el) {
          (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
        }
      });
    });
  }, [tree, treeMap]);

  const selectedNode = selectedKey ? treeMap.get(selectedKey) ?? null : null;
  const totalChars = tree.charCount;

  // 稳定 toggle handler 引用,让 TreeNode 的 memo areEqual 不会因 fn 引用变化而 cache miss
  const handleToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
            {tree.children.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                selectedId={selectedKey}
                expanded={expanded}
                onSelect={setSelectedKey}
                onToggle={handleToggle}
                depthOffset={1}
              />
            ))}
          </ul>
        </aside>
        <section className="llm-input-main">
          <NodeDetail node={selectedNode} selfObjectId={selfObjectId} onUserReply={onUserReply} sessionId={sessionId} />
        </section>
      </div>
    </div>
  );
}
