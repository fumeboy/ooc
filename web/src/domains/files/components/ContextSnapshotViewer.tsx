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
  CircleSlash,
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
import { CheckCircle2 } from "lucide-react";
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
import { dispatchNavigateToWindow, subscribeNavigateToWindow } from "../navigation-events";
import { FileEditDiffView, parseEditArgs } from "./FileEditDiffView";
import { FileWindowContentView } from "./FileWindowContentView";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { useDisplayName, useWindowTypes } from "../../objects";

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
  search: Search,
  relation: Users,
  custom: Puzzle,
  skill_index: Sparkles,
  feishu_chat: MessageSquare,
  feishu_doc: FileText,
  plan: ClipboardList,
};

/** 已有专用渲染分支的 window type 集合；不在集合中的类型由 NodeDetail 末尾的 JSON 兜底渲染。 */
const HANDLED_WINDOW_TYPES = new Set<string>([
  "root",
  "command_exec",
  "do",
  "todo",
  "talk",
  "program",
  "file",
  "knowledge",
  "search",
  "relation",
  "custom",
  "skill_index",
  "feishu_chat",
  "feishu_doc",
  "plan",
]);

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
    case "success":
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
  const isExecuting = node.data.kind === "window" && node.data.window.type === "command_exec" && node.data.window.status === "executing";
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
 * Relation window 详情面板。
 *
 * 2026-05-27 修订（撤回 R8-5 + 删除占位文案）：
 * - peer_readme section 重新挂回（render: stones/<peer>/readable.md, 只读）；
 *   default visibility 让大量 sibling/child relation 自动派生，没 readme 内容
 *   则空壳，违背 default visibility 初衷
 * - 缺失的 section 不再渲染占位文案；exists=false 或 body 空直接跳过整段
 */
function RelationWindowDetail({
  window,
}: {
  window: Extract<ContextWindow, { type: "relation" }>;
}) {
  const { displayName } = useDisplayName(window.peerId);
  return (
    <div className="llm-input-md-body" style={{ padding: "8px 12px" }}>
      <div className="llm-input-attrs" style={{ marginBottom: 8 }}>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">peer</span>
          <span className="llm-input-attr-value">
            {displayName !== window.peerId ? `${displayName} (${window.peerId})` : window.peerId}
          </span>
        </div>
      </div>

      {window.peerReadmeExists && window.peerReadmeBody ? (
        <>
          <h3 style={{ marginTop: 16 }}>peer · readme</h3>
          {window.peerReadmePath ? (
            <div className="muted small" style={{ marginBottom: 4 }}>{window.peerReadmePath}</div>
          ) : null}
          <MarkdownContent content={window.peerReadmeBody} />
        </>
      ) : null}

      {window.selfLongTermExists && window.selfLongTermBody ? (
        <>
          <h3 style={{ marginTop: 16 }}>self · long_term</h3>
          {window.selfLongTermPath ? (
            <div className="muted small" style={{ marginBottom: 4 }}>{window.selfLongTermPath}</div>
          ) : null}
          <MarkdownContent content={window.selfLongTermBody} />
        </>
      ) : null}

      {window.selfSessionExists && window.selfSessionBody ? (
        <>
          <h3 style={{ marginTop: 16 }}>self · session</h3>
          {window.selfSessionPath ? (
            <div className="muted small" style={{ marginBottom: 4 }}>{window.selfSessionPath}</div>
          ) : null}
          <MarkdownContent content={window.selfSessionBody} />
        </>
      ) : null}
    </div>
  );
}

/**
 * Window 上可用的 command 清单(chips)。catalog 来自 `/api/windows/types`,缓存在
 * useWindowTypes 内,不随 thread polling 重拉。空数组(如 todo)隐藏整段;catalog
 * 还没到位先不渲染,避免 "0 commands" 闪烁。
 *
 * Hover chip 时弹一个 markdown tooltip 展示 command 描述(取自后端 *_BASIC 路径,
 * 通常 200~1500 字符)。无 description 的 chip 退化成只显示名字。
 */
function WindowCommandsChips({ type }: { type: string }) {
  const catalog = useWindowTypes();
  const entry = catalog?.[type];
  if (!entry || entry.commands.length === 0) return null;
  // 历史上这里有一行 hint："commands open(parent_window_id=..., command=..., args={...})"
  // 用户反馈：对真实使用是噪声（chips 已自带名字，hover 看 description 即可）。去掉。
  return (
    <div className="llm-input-commands">
      <div className="llm-input-commands-chips">
        {entry.commands.map((cmd) => (
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

/**
 * 模块级缓存的 world config(siteName / larkTenantHost)。
 *
 * - 同一会话内多个 detail 组件共享一份;首次 mount 触发 fetch,后续直接返回。
 * - 10 秒 TTL 已经够用:siteName/larkTenantHost 几乎不会运行时改;真要刷只需 reload。
 * - 避免每个 feishu_doc / feishu_chat detail 都自带 fetch 抖,也避免引入全局 Context。
 */
type WorldConfigCache = {
  siteName?: string;
  larkTenantHost?: string;
  hasLarkBot?: boolean;
};
let worldConfigCache: WorldConfigCache | null = null;
let worldConfigInflight: Promise<WorldConfigCache> | null = null;
let worldConfigFetchedAt = 0;
const worldConfigSubscribers = new Set<() => void>();

async function fetchWorldConfigCached(): Promise<WorldConfigCache> {
  const now = Date.now();
  if (worldConfigCache && now - worldConfigFetchedAt < 10_000) return worldConfigCache;
  if (worldConfigInflight) return worldConfigInflight;
  worldConfigInflight = (async () => {
    try {
      // 直接 fetch 避免引入 transport 依赖循环
      const res = await fetch("/api/world/config");
      const data = (await res.json()) as WorldConfigCache;
      worldConfigCache = data;
      worldConfigFetchedAt = Date.now();
      for (const cb of worldConfigSubscribers) cb();
      return data;
    } finally {
      worldConfigInflight = null;
    }
  })();
  return worldConfigInflight;
}

function useWorldConfig(): WorldConfigCache | null {
  const [, force] = useState(0);
  useEffect(() => {
    let active = true;
    void fetchWorldConfigCached().then(() => {
      if (active) force((x) => x + 1);
    });
    const sub = () => active && force((x) => x + 1);
    worldConfigSubscribers.add(sub);
    return () => {
      active = false;
      worldConfigSubscribers.delete(sub);
    };
  }, []);
  return worldConfigCache;
}

/** kindSlug 映射;参考 spec:`https://{larkTenantHost}/{kindSlug}/{docToken}`。 */
function feishuDocKindSlug(kind: string): string {
  switch (kind) {
    case "docx": return "docx";
    case "doc": return "docs";
    case "sheet": return "sheets";
    case "base": return "base";
    case "wiki": return "wiki";
    case "drive_md": return "file";
    default: return kind;
  }
}

/** Custom window 详情面板。 */
function CustomWindowDetail({
  window,
}: {
  window: Extract<ContextWindow, { type: "custom" }>;
}) {
  const { displayName } = useDisplayName(window.objectId);
  const stonePath = `stones/main/objects/${window.objectId}/`;
  const label = displayName !== window.objectId ? `${displayName} (${window.objectId})` : window.objectId;
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">objectId</span>
          <span className="llm-input-attr-value">{label}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">stone path</span>
          <span className="llm-input-attr-value">{stonePath}</span>
        </div>
      </div>
      <div className="llm-input-empty">
        custom window 行为由 <code>{stonePath}server/index.ts</code> 的 <code>ObjectWindowDefinition</code> 决定;
        通过上方 commands chip 调用。
      </div>
    </>
  );
}

/** Skill index window 详情面板:按 scope 分组。 */
function SkillIndexWindowDetail({
  window,
}: {
  window: Extract<ContextWindow, { type: "skill_index" }>;
}) {
  // scope 分组顺序:object > branch > external(由近到远;Agent 自己的 skill 最先看到)
  const groups: Array<{ scope: "object" | "branch" | "external"; label: string; skills: typeof window.skills }> = [
    { scope: "object", label: "object", skills: window.skills.filter((s) => s.scope === "object") },
    { scope: "branch", label: "branch", skills: window.skills.filter((s) => s.scope === "branch") },
    { scope: "external", label: "external", skills: window.skills.filter((s) => s.scope === "external") },
  ];
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">total</span>
          <span className="llm-input-attr-value">
            {window.skills.length} skill{window.skills.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="cw-skill-groups">
        {groups.map((g) => {
          if (g.skills.length === 0) return null;
          return (
            <div key={g.scope} className="cw-skill-group">
              <div className="cw-skill-group-head">
                <span className="cw-skill-scope-badge" data-scope={g.scope}>{g.label}</span>
                <span className="cw-skill-count muted small">{g.skills.length}</span>
              </div>
              <ul className="cw-skill-list">
                {g.skills.map((s) => (
                  <li key={`${g.scope}:${s.name}`} className="cw-skill-item" title={s.skillFilePath}>
                    <div className="cw-skill-item-head">
                      <span className="cw-skill-name">{s.name}</span>
                      <span className="cw-skill-path muted small">{s.skillFilePath}</span>
                    </div>
                    <div className="cw-skill-desc">{s.description}</div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {window.skills.length === 0 && (
          <div className="llm-input-empty">该 thread 当前未挂载任何 skill。</div>
        )}
      </div>
    </>
  );
}

/** Feishu chat window 详情面板:行式消息流。 */
function FeishuChatWindowDetail({
  window,
}: {
  window: Extract<ContextWindow, { type: "feishu_chat" }>;
}) {
  const lastRefresh = window.lastRefreshAtMs
    ? new Date(window.lastRefreshAtMs).toLocaleString()
    : "(never)";
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">chat</span>
          <span className="llm-input-attr-value">{window.chatName} ({window.chatId})</span>
        </div>
        {window.chatType && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">chat type</span>
            <span className="llm-input-attr-value">{window.chatType}</span>
          </div>
        )}
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">mode</span>
          <span className="llm-input-attr-value">
            {window.mode}
            {window.mode === "tail" && window.tailCount ? ` (${window.tailCount})` : ""}
            {window.mode === "search" && window.searchQuery ? ` "${window.searchQuery}"` : ""}
            {window.mode === "thread" && window.threadAnchorMessageId ? ` @${window.threadAnchorMessageId}` : ""}
          </span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">last refresh</span>
          <span className="llm-input-attr-value">{lastRefresh}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">buffer size</span>
          <span className="llm-input-attr-value">{window.buffer.length} message{window.buffer.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      {window.buffer.length === 0 ? (
        <div className="llm-input-empty">buffer 为空,先 refresh。</div>
      ) : (
        <ul className="cw-feishu-msg-list">
          {window.buffer.map((m) => {
            const time = new Date(m.createTimeMs).toLocaleTimeString();
            return (
              <li key={m.messageId} className="cw-feishu-msg-row">
                <span className="cw-feishu-msg-time">{time}</span>
                <span className="cw-feishu-msg-sender">{m.sender}</span>
                {m.senderKind && (
                  <span className="cw-feishu-msg-kind" data-kind={m.senderKind}>
                    {m.senderKind}
                  </span>
                )}
                {m.replyToMessageId && (
                  <span className="cw-feishu-msg-reply muted small">↪ {m.replyToMessageId}</span>
                )}
                <span className="cw-feishu-msg-text">{m.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Feishu doc window 详情面板:markdown 长正文支持折叠。 */
const FEISHU_DOC_PREVIEW_LIMIT = 400;

function FeishuDocWindowDetail({
  window,
}: {
  window: Extract<ContextWindow, { type: "feishu_doc" }>;
}) {
  const config = useWorldConfig();
  const tenantHost = config?.larkTenantHost;
  const slug = feishuDocKindSlug(window.docKind);
  const docUrl = tenantHost ? `https://${tenantHost}/${slug}/${window.docToken}` : null;
  const lastFetched = window.lastFetchedAtMs
    ? new Date(window.lastFetchedAtMs).toLocaleString()
    : "(never)";

  const [expanded, setExpanded] = useState(false);
  const body = window.content?.body ?? "";
  const isMarkdown = window.content?.format === "markdown";
  const longBody = body.length > FEISHU_DOC_PREVIEW_LIMIT;
  const previewBody = longBody && !expanded ? body.slice(0, FEISHU_DOC_PREVIEW_LIMIT) + "…" : body;

  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">doc</span>
          <span className="llm-input-attr-value">
            {window.docTitle}{" "}
            {docUrl ? (
              <a href={docUrl} target="_blank" rel="noreferrer" className="cw-feishu-doc-link">
                <ExternalLink size={11} aria-hidden="true" /> open
              </a>
            ) : (
              <span className="muted small">(host 未配置)</span>
            )}
          </span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">kind / token</span>
          <span className="llm-input-attr-value">{window.docKind} · {window.docToken}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">mode</span>
          <span className="llm-input-attr-value">{window.mode}</span>
        </div>
        {window.versionId && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">version</span>
            <span className="llm-input-attr-value">{window.versionId}</span>
          </div>
        )}
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">last fetched</span>
          <span className="llm-input-attr-value">{lastFetched}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">format</span>
          <span className="llm-input-attr-value">{window.content?.format ?? "(empty)"} · {body.length} chars</span>
        </div>
      </div>
      {body.length === 0 ? (
        <div className="llm-input-empty">content 为空;先用 read 拉一次。</div>
      ) : isMarkdown ? (
        <div className="llm-input-md-body">
          <MarkdownContent content={previewBody} />
          {longBody && (
            <button
              type="button"
              className="cw-feishu-doc-expand"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收起" : `展开全文 (${body.length} 字)`}
            </button>
          )}
        </div>
      ) : (
        // blocks 形态:暂展示 body 字符串(后端通常是 with-ids XML 文本)
        <pre className="llm-input-pre">{previewBody}</pre>
      )}
      {!isMarkdown && longBody && (
        <div style={{ padding: "0 14px 12px" }}>
          <button
            type="button"
            className="cw-feishu-doc-expand"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : `展开全文 (${body.length} 字)`}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Plan window 详情面板（2026-05-26 R7 B5）。
 *
 * 最小可工作渲染：
 * - header: title + description + step 进度 (X/Y done)
 * - steps: 每条 step 配 status icon（pending ○ / in-progress ◐ / done ✓ / blocked ⊘）+ 文本
 * - 若 step.subPlanWindowId 存在：渲染可点击链接，点击调 dispatchNavigateToWindow 切换到子 plan
 * - 若 parentPlanWindowId 存在：底部渲染回父 plan 的链接（含 parentStepId）
 * - status === "archived" 时整个面板加 muted 类做视觉灰化
 */
function PlanWindowDetail({
  window,
}: {
  window: Extract<ContextWindow, { type: "plan" }>;
}) {
  const total = window.steps.length;
  const doneN = window.steps.filter((s) => s.status === "done").length;
  const isArchived = window.status === "archived";

  const renderStepIcon = (status: "pending" | "in-progress" | "done" | "blocked") => {
    switch (status) {
      case "done":
        return <CheckCircle2 size={13} aria-label="done" className="cw-plan-step-icon cw-plan-step-done" />;
      case "in-progress":
        return <CircleDot size={13} aria-label="in-progress" className="cw-plan-step-icon cw-plan-step-inprogress" />;
      case "blocked":
        return <CircleSlash size={13} aria-label="blocked" className="cw-plan-step-icon cw-plan-step-blocked" />;
      case "pending":
      default:
        return <Circle size={13} aria-label="pending" className="cw-plan-step-icon cw-plan-step-pending" />;
    }
  };

  return (
    <div
      className={`llm-input-md-body cw-plan-detail${isArchived ? " muted" : ""}`}
      style={{ padding: "8px 12px" }}
      data-testid="plan-window-detail"
    >
      <div className="llm-input-attrs" style={{ marginBottom: 8 }}>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">plan</span>
          <span className="llm-input-attr-value">{window.title}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">progress</span>
          <span className="llm-input-attr-value">
            {doneN}/{total} done
          </span>
        </div>
      </div>

      {window.description && (
        <div className="cw-plan-description" style={{ marginBottom: 12 }}>
          <MarkdownContent content={window.description} />
        </div>
      )}

      <h3 style={{ marginTop: 8 }}>
        Steps ({doneN}/{total} done)
      </h3>
      {total === 0 ? (
        <div className="llm-input-empty">该 plan 尚未添加 step。</div>
      ) : (
        <ul className="cw-plan-step-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {window.steps.map((step) => (
            <li
              key={step.id}
              className={`cw-plan-step cw-plan-step-status-${step.status}`}
              style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}
              data-step-id={step.id}
              data-step-status={step.status}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {renderStepIcon(step.status)}
                <span className="cw-plan-step-id muted small">{step.id}</span>
                <span className="cw-plan-step-status-label muted small">({step.status})</span>
                <span className="cw-plan-step-text">{step.text}</span>
              </div>
              {step.subPlanWindowId && (
                <div style={{ marginLeft: 22 }}>
                  <button
                    type="button"
                    className="cw-plan-subplan-link"
                    onClick={() => dispatchNavigateToWindow(step.subPlanWindowId!)}
                    title="跳转到 sub plan"
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "var(--link, #2563eb)",
                      cursor: "pointer",
                      textDecoration: "underline",
                      fontSize: "0.85em",
                    }}
                  >
                    [sub plan: {step.subPlanWindowId}]
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {window.parentPlanWindowId && (
        <div className="cw-plan-parent-link" style={{ marginTop: 12 }}>
          <span className="muted small">Parent: </span>
          <button
            type="button"
            className="cw-plan-parent-link-btn"
            onClick={() => dispatchNavigateToWindow(window.parentPlanWindowId!)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "var(--link, #2563eb)",
              cursor: "pointer",
              textDecoration: "underline",
              fontSize: "0.9em",
            }}
          >
            {window.parentPlanWindowId}
          </button>
          {window.parentStepId && (
            <span className="muted small"> at step {window.parentStepId}</span>
          )}
        </div>
      )}
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
            <WindowCommandsChips type={window.type} />
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
              <span className="llm-input-attr-key">method</span>
              <span className="llm-input-attr-value">{window.method}</span>
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
          {(() => {
            const args = window.accumulatedArgs ?? {};
            const isEdit = window.method === "edit";
            const isWriteFile = window.method === "write_file";
            // edit:渲染为 unified diff
            if (isEdit) {
              const pairs = parseEditArgs(args);
              if (pairs) {
                return (
                  <div className="llm-input-edit-block">
                    <div className="llm-input-edit-head">
                      file edit · {pairs.length} change{pairs.length === 1 ? "" : "s"}
                    </div>
                    <FileEditDiffView pairs={pairs} />
                  </div>
                );
              }
            }
            // write_file:把 content 作为大段文本预览,其它字段平铺
            if (isWriteFile && typeof (args as Record<string, unknown>).content === "string") {
              const rec = args as Record<string, unknown>;
              return (
                <>
                  <div className="llm-input-attrs">
                    {typeof rec.path === "string" && (
                      <div className="llm-input-attr-row">
                        <span className="llm-input-attr-key">path</span>
                        <span className="llm-input-attr-value">{rec.path}</span>
                      </div>
                    )}
                    <div className="llm-input-attr-row">
                      <span className="llm-input-attr-key">content size</span>
                      <span className="llm-input-attr-value">{(rec.content as string).length} chars</span>
                    </div>
                  </div>
                  <div className="llm-input-edit-block">
                    <div className="llm-input-edit-head">write_file content</div>
                    <pre className="llm-input-pre">{rec.content as string}</pre>
                  </div>
                </>
              );
            }
            // 兜底:展示 JSON
            if (Object.keys(args).length > 0) {
              return (
                <CodeMirror
                  className="code-editor is-readonly"
                  value={formatJson(args)}
                  editable={false}
                  extensions={[jsonLanguage()]}
                  basicSetup={{ lineNumbers: false, foldGutter: true }}
                />
              );
            }
            return null;
          })()}
          {/* Round 13: 仅 failed 状态保留 result 渲染 (success 已自动移除) */}
          {window.status === "failed" && window.result && (
            <pre className={`llm-input-pre llm-input-result-${statusToTone(window.status)}`}>{window.result}</pre>
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
      {window.type === "relation" && <RelationWindowDetail window={window} />}
      {window.type === "custom" && <CustomWindowDetail window={window} />}
      {window.type === "skill_index" && <SkillIndexWindowDetail window={window} />}
      {window.type === "feishu_chat" && <FeishuChatWindowDetail window={window} />}
      {window.type === "feishu_doc" && <FeishuDocWindowDetail window={window} />}
      {window.type === "plan" && <PlanWindowDetail window={window} />}
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
        <>
          <div className="llm-input-attrs">
            <div className="llm-input-attr-row">
              <span className="llm-input-attr-key">execs</span>
              <span className="llm-input-attr-value">{window.history.length}</span>
            </div>
          </div>
          {window.history.length > 0 && (
            <ul className="llm-input-exec-list">
              {window.history.map((exec, idx) => {
                const isLast = idx === window.history.length - 1;
                const head = exec.language === "function"
                  ? `fn:${exec.function ?? "?"}`
                  : `${exec.language}: ${(exec.code ?? "").split("\n")[0] ?? ""}`;
                return (
                  <li key={exec.execId} className={`llm-input-exec-item llm-input-exec-${exec.ok ? "ok" : "fail"}`}>
                    <div className="llm-input-exec-head">
                      <span className="llm-input-exec-index">[#{idx}]</span>
                      <span className="llm-input-exec-lang">{exec.language}</span>
                      <span className="llm-input-exec-status">{exec.ok ? "ok" : "fail"}</span>
                      <span className="llm-input-exec-time">{new Date(exec.startedAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="llm-input-exec-title">{head}</div>
                    {isLast && exec.code && (
                      <div className="llm-input-exec-section">
                        <div className="llm-input-exec-section-label">script</div>
                        <CodeMirror
                          className="code-editor is-readonly llm-input-exec-code"
                          value={exec.code}
                          editable={false}
                          basicSetup={{ lineNumbers: true, foldGutter: false }}
                        />
                      </div>
                    )}
                    {isLast && exec.args !== undefined && (
                      <div className="llm-input-exec-section">
                        <div className="llm-input-exec-section-label">args</div>
                        <CodeMirror
                          className="code-editor is-readonly llm-input-exec-code"
                          value={formatJson(exec.args)}
                          editable={false}
                          extensions={[jsonLanguage()]}
                          basicSetup={{ lineNumbers: false, foldGutter: false }}
                        />
                      </div>
                    )}
                    {exec.output && (
                      <div className="llm-input-exec-section">
                        <div className="llm-input-exec-section-label">output</div>
                        <pre className="llm-input-pre llm-input-exec-output">{isLast ? exec.output : previewText(exec.output, 200)}</pre>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {window.type === "file" && (
        <>
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
          <FileWindowContentView path={window.path} lines={window.lines} columns={window.columns} />
        </>
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
          {window.body && (
            <div className="llm-input-md-body">
              <MarkdownContent content={window.body} />
            </div>
          )}
        </>
      )}
      {window.type === "search" && (
        <>
          <div className="llm-input-attrs">
            <div className="llm-input-attr-row">
              <span className="llm-input-attr-key">kind</span>
              <span className="llm-input-attr-value">{window.kind}</span>
            </div>
            <div className="llm-input-attr-row">
              <span className="llm-input-attr-key">query</span>
              <span className="llm-input-attr-value">{window.query}</span>
            </div>
            {window.searchRoot && (
              <div className="llm-input-attr-row">
                <span className="llm-input-attr-key">search_root</span>
                <span className="llm-input-attr-value">{window.searchRoot}</span>
              </div>
            )}
            <div className="llm-input-attr-row">
              <span className="llm-input-attr-key">matches</span>
              <span className="llm-input-attr-value">{window.matches.length}{window.truncated ? " (truncated)" : ""}</span>
            </div>
          </div>
          {window.matches.length > 0 && (
            <ul className="llm-input-transcript-list">
              {window.matches.map((m) => (
                <li key={m.index} className="llm-input-transcript-item">
                  <div className="llm-input-transcript-meta">
                    <span className="llm-input-transcript-index">[#{m.index}]</span>
                    <span className="llm-input-transcript-dir">{m.path}{m.line ? `:${m.line}` : ""}</span>
                  </div>
                  {m.snippet && <pre className="llm-input-transcript-content">{m.snippet}</pre>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {/* 未知 window 类型兜底：把整个对象按 JSON 显示，保证新增 type 即使前端没补
          专用渲染也能看到内容。已实现 case 的类型在这里被跳过，避免重复显示。 */}
      {!HANDLED_WINDOW_TYPES.has(window.type) && (
        <CodeMirror
          className="code-editor is-readonly"
          value={formatJson(window)}
          editable={false}
          extensions={[jsonLanguage()]}
          basicSetup={{ lineNumbers: false, foldGutter: true }}
        />
      )}
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
}: {
  snapshot: ContextSnapshot;
  /** 当前 thread 的 self objectId；用于决定 talk window 的 user 端 composer 是否要显示。 */
  selfObjectId?: string;
  /** 用户以 user 身份回复 talk window 时的发送回调；缺省时不显示 composer。 */
  onUserReply?: (text: string) => Promise<void>;
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
          <NodeDetail node={selectedNode} selfObjectId={selfObjectId} onUserReply={onUserReply} />
        </section>
      </div>
    </div>
  );
}
