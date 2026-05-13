import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import type { FileContent } from "../model";

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
};

type XmlNodeRecord = {
  id: string;
  kind: "element" | "comment";
  tag?: string;
  attrs?: Record<string, string>;
  text: string;
  children: XmlNodeRecord[];
  depth: number;
  charCount: number;
};

type ParsedInputItem = {
  key: string;
  item: LlmInputItem;
  label: string;
  summary: string;
  charCount: number;
  xmlRoots: XmlNodeRecord[] | null;
};

type ViewerTreeNode = {
  id: string;
  label: string;
  summary?: string;
  depth: number;
  charCount: number;
  children: ViewerTreeNode[];
  badge?: string;
  data:
    | { kind: "input_item"; parsedItem: ParsedInputItem; index: number }
    | { kind: "xml_node"; xmlNode: XmlNodeRecord; parentItem: ParsedInputItem; index: number };
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
  return /(^|\/)llm\.input\.json$/.test(path);
}

function tryParseXmlRoots(raw: string): XmlNodeRecord[] | null {
  const source = raw.trim();
  if (!source || !source.startsWith("<")) return null;

  const parser = new DOMParser();
  const firstPass = parser.parseFromString(source, "application/xml");
  if (!firstPass.querySelector("parsererror") && firstPass.documentElement) {
    return [domNodeToXmlNode(firstPass.documentElement, { next: 0 }, 0)];
  }

  const wrapped = parser.parseFromString(`<ooc-root>${source}</ooc-root>`, "application/xml");
  if (wrapped.querySelector("parsererror") || !wrapped.documentElement) {
    return null;
  }

  const idSeed = { next: 0 };
  const roots = Array.from(wrapped.documentElement.childNodes)
    .map((node) => domNodeToXmlChild(node, idSeed, 0))
    .filter((node): node is XmlNodeRecord => node !== null);

  return roots.length > 0 ? roots : null;
}

function domNodeToXmlChild(node: ChildNode, idSeed: { next: number }, depth: number): XmlNodeRecord | null {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return domNodeToXmlNode(node as Element, idSeed, depth);
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    const text = (node.nodeValue ?? "").trim();
    if (!text) return null;
    return {
      id: `xml-${idSeed.next++}`,
      kind: "comment",
      text,
      children: [],
      depth,
      charCount: text.length,
    };
  }
  return null;
}

function domNodeToXmlNode(element: Element, idSeed: { next: number }, depth: number): XmlNodeRecord {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    attrs[attr.name] = attr.value;
  }

  const children = Array.from(element.childNodes)
    .map((node) => domNodeToXmlChild(node, idSeed, depth + 1))
    .filter((node): node is XmlNodeRecord => node !== null);

  const textNodes = Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.nodeValue ?? "")
    .join("\n")
    .trim();

  const charCount = textNodes.length + children.reduce((sum, child) => sum + child.charCount, 0);

  return {
    id: `xml-${idSeed.next++}`,
    kind: "element",
    tag: element.tagName,
    attrs,
    text: children.length === 0 ? textNodes : textNodes,
    children,
    depth,
    charCount,
  };
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
  return record.inputItems.map((item, index) => {
    const base = summarizeItem(item);
    const xmlRoots = item.type === "message" && item.role === "system" ? tryParseXmlRoots(item.content) : null;
    return {
      key: `${item.type}-${index}`,
      item,
      label: base.label,
      summary: base.summary,
      charCount: base.charCount,
      xmlRoots,
    };
  });
}

function labelForXmlNode(node: XmlNodeRecord): string {
  if (node.kind === "comment") return `<!-- ${previewText(node.text, 48)} -->`;
  if (Object.keys(node.attrs ?? {}).length > 0) {
    return `<${node.tag} ${Object.entries(node.attrs ?? {})
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" ")}>`;
  }
  return `<${node.tag}>`;
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function serializeXmlNode(node: XmlNodeRecord, depth = 0): string {
  const indent = "  ".repeat(depth);

  if (node.kind === "comment") {
    return `${indent}<!-- ${node.text} -->`;
  }

  const attrs = Object.entries(node.attrs ?? {})
    .map(([key, value]) => ` ${key}="${escapeXmlText(value)}"`)
    .join("");

  if (node.children.length === 0) {
    const text = node.text ? escapeXmlText(node.text) : "";
    return `${indent}<${node.tag}${attrs}>${text}</${node.tag}>`;
  }

  const renderedChildren = node.children.map((child) => serializeXmlNode(child, depth + 1));
  const bodyParts = node.text ? [`${"  ".repeat(depth + 1)}${escapeXmlText(node.text)}`, ...renderedChildren] : renderedChildren;

  return `${indent}<${node.tag}${attrs}>\n${bodyParts.join("\n")}\n${indent}</${node.tag}>`;
}

function buildViewerTree(parsedItems: ParsedInputItem[]): ViewerTreeNode[] {
  const toXmlTree = (xmlNode: XmlNodeRecord, parentItem: ParsedInputItem, index: number): ViewerTreeNode => ({
    id: `${parentItem.key}:${xmlNode.id}`,
    label: labelForXmlNode(xmlNode),
    summary: xmlNode.text ? previewText(xmlNode.text, 84) : undefined,
    depth: xmlNode.depth + 1,
    charCount: xmlNode.charCount,
    children: xmlNode.children.map((child) => toXmlTree(child, parentItem, index)),
    data: { kind: "xml_node", xmlNode, parentItem, index },
  });

  return parsedItems.map((parsedItem, index) => ({
    id: parsedItem.key,
    label: parsedItem.label,
    summary: parsedItem.summary,
    depth: 0,
    charCount: parsedItem.charCount,
    badge: parsedItem.xmlRoots ? "XML" : undefined,
    children: parsedItem.xmlRoots?.map((root) => toXmlTree(root, parsedItem, index)) ?? [],
    data: { kind: "input_item", parsedItem, index },
  }));
}

function TreeNode({
  node,
  selectedId,
  expanded,
  onSelect,
  onToggle,
}: {
  node: ViewerTreeNode;
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
            <span className={`llm-input-tree-label ${node.data.kind === "xml_node" && node.data.xmlNode.kind === "comment" ? "is-comment" : ""}`}>
              {node.label}
            </span>
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

function XmlNodeDetail({ node }: { node: XmlNodeRecord | null }) {
  if (!node) {
    return <div className="llm-input-empty">选择左侧 XML 节点查看详情。</div>;
  }

  const attrs = Object.entries(node.attrs ?? {});
  const rawXml = serializeXmlNode(node);
  return (
    <div className="llm-input-detail-body">
      <div className="llm-input-detail-header">
        <div>
          <div className="llm-input-detail-title">{node.kind === "comment" ? "XML Comment" : node.tag}</div>
          <div className="llm-input-detail-meta">{node.charCount} chars · ~{estimateTokens(node.charCount)} tokens</div>
        </div>
      </div>
      {attrs.length > 0 && (
        <div className="llm-input-attrs">
          {attrs.map(([key, value]) => (
            <div key={key} className="llm-input-attr-row">
              <span className="llm-input-attr-key">{key}</span>
              <span className="llm-input-attr-value">{value}</span>
            </div>
          ))}
        </div>
      )}
      {node.text ? (
        <pre className="llm-input-pre">{node.text}</pre>
      ) : node.children.length > 0 ? (
        <>
          <div className="llm-input-empty">该节点包含 {node.children.length} 个子节点，请从左侧继续展开查看。</div>
          <div className="llm-input-codeblock">
            <CodeMirror
              className="code-editor is-readonly"
              value={rawXml}
              editable={false}
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          </div>
        </>
      ) : (
        <div className="llm-input-empty">该节点无文本内容。</div>
      )}
    </div>
  );
}

function InputItemDetail({ parsedItem }: { parsedItem: ParsedInputItem | null }) {
  if (!parsedItem) {
    return <div className="llm-input-empty">选择左侧节点查看详情。</div>;
  }

  switch (parsedItem.item.type) {
    case "message":
      return (
        <div className="llm-input-detail-body">
          <div className="llm-input-detail-header">
            <div>
              <div className="llm-input-detail-title">{parsedItem.item.role} message</div>
              <div className="llm-input-detail-meta">{parsedItem.charCount} chars · ~{estimateTokens(parsedItem.charCount)} tokens</div>
            </div>
            {parsedItem.xmlRoots && <span className="pill">XML</span>}
          </div>
          {parsedItem.xmlRoots ? (
            <div className="llm-input-codeblock llm-input-codeblock-inline">
              <CodeMirror
                className="code-editor is-readonly"
                value={parsedItem.item.content}
                editable={false}
                basicSetup={{ lineNumbers: true, foldGutter: true }}
              />
            </div>
          ) : (
            <pre className="llm-input-pre">{parsedItem.item.content}</pre>
          )}
        </div>
      );
    case "function_call":
      return (
        <div className="llm-input-detail-body">
          <div className="llm-input-detail-header">
            <div>
              <div className="llm-input-detail-title">function_call · {parsedItem.item.name}</div>
              <div className="llm-input-detail-meta">call_id: {parsedItem.item.call_id}</div>
            </div>
          </div>
          <CodeMirror
            className="code-editor is-readonly"
            value={formatJson(parsedItem.item.arguments)}
            editable={false}
            extensions={[jsonLanguage()]}
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        </div>
      );
    case "function_call_output": {
      const looksLikeJson = parsedItem.item.output.trim().startsWith("{") || parsedItem.item.output.trim().startsWith("[");
      return (
        <div className="llm-input-detail-body">
          <div className="llm-input-detail-header">
            <div>
              <div className="llm-input-detail-title">function_call_output{parsedItem.item.name ? ` · ${parsedItem.item.name}` : ""}</div>
              <div className="llm-input-detail-meta">call_id: {parsedItem.item.call_id}</div>
            </div>
          </div>
          {looksLikeJson ? (
            <CodeMirror
              className="code-editor is-readonly"
              value={parsedItem.item.output}
              editable={false}
              extensions={[jsonLanguage()]}
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          ) : (
            <pre className="llm-input-pre">{parsedItem.item.output}</pre>
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
          <pre className="llm-input-pre">{parsedItem.item.text}</pre>
        </div>
      );
  }
}

function ViewerDetail({ selectedNode }: { selectedNode: ViewerTreeNode | null }) {
  if (!selectedNode) return <div className="llm-input-empty">选择左侧节点查看详情。</div>;
  if (selectedNode.data.kind === "xml_node") {
    return <XmlNodeDetail node={selectedNode.data.xmlNode} />;
  }
  return <InputItemDetail parsedItem={selectedNode.data.parsedItem} />;
}

function flattenViewerTree(nodes: ViewerTreeNode[]): Map<string, ViewerTreeNode> {
  const map = new Map<string, ViewerTreeNode>();
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    map.set(node.id, node);
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]!);
    }
  }
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedKey(tree[0]?.id ?? null);
    const next = new Set<string>();
    for (const node of tree) {
      next.add(node.id);
      for (const child of node.children) {
        next.add(child.id);
      }
    }
    setExpanded(next);
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
          <div className="llm-input-sidebar-title">input_items + xml tree</div>
          <ul className="llm-input-item-list">
            {tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
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
            ))}
          </ul>
        </aside>
        <section className="llm-input-main">
          <ViewerDetail selectedNode={selectedNode} />
        </section>
      </div>
    </div>
  );
}

export { isLlmInputJsonPath };
