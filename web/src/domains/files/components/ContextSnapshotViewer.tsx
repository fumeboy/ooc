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
  buildContextTree,
  collectAllNodeIds,
  estimateTokens,
  flattenContextTree,
  type ContextNode,
  type ContextSnapshot,
  type ContextWindow,
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

/** 复用 LLMInputJsonViewer 的左树行样式；data 仅用于详情面板。 */
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
  return (
    <li>
      <div
        className={`llm-input-tree-row ${isSelected ? "is-selected" : ""}`}
        style={{ paddingLeft: `${node.depth * 14 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            type="button"
            className="llm-input-tree-toggle"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node.id);
            }}
          >
            {isExpanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className="llm-input-tree-spacer" />
        )}
        <div className="llm-input-tree-content">
          <div className="llm-input-tree-head">
            <span className="llm-input-tree-label">{node.label}</span>
            {node.badge && <span className="llm-input-tree-badge">{node.badge}</span>}
          </div>
          {node.summary && <div className="llm-input-tree-summary">{node.summary}</div>}
        </div>
        <span className="llm-input-tree-size">{node.charCount}</span>
      </div>
      {hasChildren && isExpanded && (
        <ul>
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

/** Window 详情：按 type narrow 渲染特定字段；通用字段（id/title/status）始终渲染。 */
function WindowDetail({ window }: { window: ContextWindow }) {
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
    </div>
  );
}

/** 详情面板：按 ContextNode.data.kind 走分支。 */
function NodeDetail({ node }: { node: ContextNode | null }) {
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
    return <WindowDetail window={data.window} />;
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
export function ContextSnapshotViewer({ snapshot }: { snapshot: ContextSnapshot }) {
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
          <ul className="llm-input-item-list">
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
          <NodeDetail node={selectedNode} />
        </section>
      </div>
    </div>
  );
}
