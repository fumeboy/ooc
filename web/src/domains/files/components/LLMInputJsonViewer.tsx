/**
 * LLMInputJsonViewer — 渲染 thread debug 目录下的 llm.input.json / loop_NNN.input.json。
 *
 * 与旧版（Step 1）相比：
 * - 不再用 DOMParser 解析 system message 的 XML；新版 llm.input.json 已经把结构化
 *   contextSnapshot 一并落盘（由后端 captureContextSnapshot 写入），UI 直接消费即可
 * - system message 的详情面板嵌入 ContextSnapshotViewer
 * - 旧版 llm.input.json 没有 contextSnapshot 字段时，回退到展示原始 system text
 */

import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import type { FileContent } from "../model";
import type { ContextSnapshot } from "../context-snapshot";
import { ContextSnapshotViewer } from "./ContextSnapshotViewer";

type LlmInputItem =
  | {
      type: "message";
      role: "system" | "user" | "assistant";
      content: string;
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "function_call_output";
      call_id: string;
      name?: string;
      output: string;
    }
  | {
      type: "reasoning";
      text: string;
    };

type LlmInputDebugRecord = {
  threadId: string;
  inputItems: LlmInputItem[];
  contextSnapshot?: ContextSnapshot;
};

type ParsedInputItem = {
  key: string;
  item: LlmInputItem;
  label: string;
  summary: string;
  charCount: number;
  /** 仅当该 item 是 system message 且 record 含 contextSnapshot 时设置；触发详情面板嵌入 ContextSnapshotViewer。 */
  isSystemContext: boolean;
};

type ViewerTreeNode = {
  id: string;
  label: string;
  summary?: string;
  depth: number;
  charCount: number;
  children: ViewerTreeNode[];
  badge?: string;
  data: { kind: "input_item"; parsedItem: ParsedInputItem; index: number };
};

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3);
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function previewText(value: string, limit = 88): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (!singleLine) return "(empty)";
  if (singleLine.length <= limit) return singleLine;
  return `${singleLine.slice(0, limit)}…`;
}

function isLlmInputJsonPath(path: string): boolean {
  return /(^|\/)(llm|loop_\d+)\.input\.json$/.test(path);
}

function summarizeItem(item: LlmInputItem): { label: string; summary: string; charCount: number } {
  switch (item.type) {
    case "message":
      return {
        label: `${item.role} message`,
        summary: previewText(item.content),
        charCount: item.content.length,
      };
    case "function_call": {
      const args = formatJson(item.arguments);
      return {
        label: `tool:${item.name}`,
        summary: previewText(args),
        charCount: args.length,
      };
    }
    case "function_call_output":
      return {
        label: `tool output${item.name ? `:${item.name}` : ""}`,
        summary: previewText(item.output),
        charCount: item.output.length,
      };
    case "reasoning":
      return {
        label: "reasoning",
        summary: previewText(item.text),
        charCount: item.text.length,
      };
  }
}

function buildParsedItems(record: LlmInputDebugRecord): ParsedInputItem[] {
  const hasContextSnapshot = Boolean(record.contextSnapshot);
  return record.inputItems.map((item, index) => {
    const base = summarizeItem(item);
    const isSystemContext = hasContextSnapshot && item.type === "message" && item.role === "system";
    return {
      key: `${item.type}-${index}`,
      item,
      label: base.label,
      summary: base.summary,
      charCount: base.charCount,
      isSystemContext,
    };
  });
}

function buildViewerTree(parsedItems: ParsedInputItem[]): ViewerTreeNode[] {
  return parsedItems.map((parsedItem, index) => ({
    id: parsedItem.key,
    label: parsedItem.label,
    summary: parsedItem.summary,
    depth: 0,
    charCount: parsedItem.charCount,
    badge: parsedItem.isSystemContext ? "CTX" : undefined,
    children: [],
    data: { kind: "input_item", parsedItem, index },
  }));
}

function TreeNode({
  node,
  selectedId,
  onSelect,
}: {
  node: ViewerTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const isSelected = selectedId === node.id;
  return (
    <li>
      <div
        className={`llm-input-tree-row ${isSelected ? "is-selected" : ""}`}
        style={{ paddingLeft: `${node.depth * 14 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        <span className="llm-input-tree-spacer" />
        <div className="llm-input-tree-content">
          <div className="llm-input-tree-head">
            <span className="llm-input-tree-label">{node.label}</span>
            {node.badge && <span className="llm-input-tree-badge">{node.badge}</span>}
          </div>
          {node.summary && <div className="llm-input-tree-summary">{node.summary}</div>}
        </div>
        <span className="llm-input-tree-size">{node.charCount}</span>
      </div>
    </li>
  );
}

function InputItemDetail({
  parsedItem,
  contextSnapshot,
}: {
  parsedItem: ParsedInputItem | null;
  contextSnapshot?: ContextSnapshot;
}) {
  if (!parsedItem) {
    return <div className="llm-input-empty">选择左侧节点查看详情。</div>;
  }
  const item = parsedItem.item;

  // system message + 含 contextSnapshot → 嵌入 ContextSnapshotViewer
  if (parsedItem.isSystemContext && contextSnapshot && item.type === "message") {
    return <ContextSnapshotViewer snapshot={contextSnapshot} />;
  }

  switch (item.type) {
    case "message":
      return (
        <div className="llm-input-detail-body">
          <div className="llm-input-detail-header">
            <div>
              <div className="llm-input-detail-title">{item.role} message</div>
              <div className="llm-input-detail-meta">{parsedItem.charCount} chars · ~{estimateTokens(parsedItem.charCount)} tokens</div>
            </div>
          </div>
          <pre className="llm-input-pre">{item.content}</pre>
        </div>
      );
    case "function_call":
      return (
        <div className="llm-input-detail-body">
          <div className="llm-input-detail-header">
            <div>
              <div className="llm-input-detail-title">function_call · {item.name}</div>
              <div className="llm-input-detail-meta">call_id: {item.call_id}</div>
            </div>
          </div>
          <CodeMirror
            className="code-editor is-readonly"
            value={formatJson(item.arguments)}
            editable={false}
            extensions={[jsonLanguage()]}
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        </div>
      );
    case "function_call_output": {
      const looksLikeJson = item.output.trim().startsWith("{") || item.output.trim().startsWith("[");
      return (
        <div className="llm-input-detail-body">
          <div className="llm-input-detail-header">
            <div>
              <div className="llm-input-detail-title">function_call_output{item.name ? ` · ${item.name}` : ""}</div>
              <div className="llm-input-detail-meta">call_id: {item.call_id}</div>
            </div>
          </div>
          {looksLikeJson ? (
            <CodeMirror
              className="code-editor is-readonly"
              value={item.output}
              editable={false}
              extensions={[jsonLanguage()]}
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          ) : (
            <pre className="llm-input-pre">{item.output}</pre>
          )}
        </div>
      );
    }
    case "reasoning":
      return (
        <div className="llm-input-detail-body">
          <div className="llm-input-detail-header">
            <div>
              <div className="llm-input-detail-title">reasoning</div>
              <div className="llm-input-detail-meta">{parsedItem.charCount} chars · ~{estimateTokens(parsedItem.charCount)} tokens</div>
            </div>
          </div>
          <pre className="llm-input-pre">{item.text}</pre>
        </div>
      );
  }
}

function flattenViewerTree(nodes: ViewerTreeNode[]): Map<string, ViewerTreeNode> {
  const map = new Map<string, ViewerTreeNode>();
  for (const node of nodes) map.set(node.id, node);
  return map;
}

export function LLMInputJsonViewer({ file }: { file: FileContent }) {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(file.content) as LlmInputDebugRecord;
    } catch {
      return null;
    }
  }, [file.content]);

  const parsedItems = useMemo(() => (parsed ? buildParsedItems(parsed) : []), [parsed]);
  const tree = useMemo(() => buildViewerTree(parsedItems), [parsedItems]);
  const treeMap = useMemo(() => flattenViewerTree(tree), [tree]);
  const [selectedKey, setSelectedKey] = useState<string | null>(tree[0]?.id ?? null);

  useEffect(() => {
    setSelectedKey(tree[0]?.id ?? null);
  }, [tree]);

  if (!parsed || !Array.isArray(parsed.inputItems)) {
    return (
      <div className="file-viewer">
        <div className="error">llm.input.json 解析失败，已回退到原始 JSON 视图。</div>
        <CodeMirror
          className="code-editor is-readonly"
          value={file.content}
          editable={false}
          extensions={[jsonLanguage()]}
          basicSetup={{ lineNumbers: true, foldGutter: true }}
        />
      </div>
    );
  }

  const selectedNode = selectedKey ? treeMap.get(selectedKey) ?? null : null;
  const totalChars = parsedItems.reduce((sum, item) => sum + item.charCount, 0);
  const counts = parsedItems.reduce(
    (acc, item) => {
      acc[item.item.type] += 1;
      return acc;
    },
    {
      message: 0,
      function_call: 0,
      function_call_output: 0,
      reasoning: 0,
    }
  );

  return (
    <div className="llm-input-viewer">
      <div className="llm-input-header">
        <div>
          <div className="llm-input-title">LLM Input Viewer</div>
          <div className="llm-input-subtitle">thread: {parsed.threadId}</div>
        </div>
        <div className="llm-input-stats">
          <span className="pill">{parsedItems.length} items</span>
          <span className="pill">{counts.message} messages</span>
          {counts.function_call > 0 && <span className="pill">{counts.function_call} calls</span>}
          {counts.function_call_output > 0 && <span className="pill">{counts.function_call_output} outputs</span>}
          {counts.reasoning > 0 && <span className="pill">{counts.reasoning} reasoning</span>}
          <span className="pill">~{estimateTokens(totalChars)} tokens</span>
        </div>
      </div>
      <div className="llm-input-layout">
        <aside className="llm-input-items">
          <div className="llm-input-sidebar-title">input_items</div>
          <ul className="llm-input-item-list">
            {tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                selectedId={selectedKey}
                onSelect={setSelectedKey}
              />
            ))}
          </ul>
        </aside>
        <section className="llm-input-main">
          <InputItemDetail
            parsedItem={selectedNode?.data.parsedItem ?? null}
            contextSnapshot={parsed.contextSnapshot}
          />
        </section>
      </div>
    </div>
  );
}

export { isLlmInputJsonPath };
