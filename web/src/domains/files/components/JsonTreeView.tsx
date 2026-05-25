/**
 * JsonTreeView —— 折叠式 JSON 树预览，按 type 标色。
 *
 * 适用场景：file_window.path 命中 .json 时（在 FileWindowContentView 内部分发），
 * 或独立 JSON 文件预览。
 *
 * 设计取舍：
 * - 不引第三方 lib（react-json-view 等），手写递归 ~120 LOC。
 * - 默认顶层 + 1 层展开；更深层 click 展开。
 * - object 行显示 `{ n keys }`，array 行显示 `[ n items ]`，叶子值按 type 上色。
 * - 解析失败回退 CodeMirror，由调用方决定。
 */
import { useState } from "react";
import { ChevronRight } from "lucide-react";

interface JsonTreeViewProps {
  /** 解析后的 JSON value；调用方负责 try/catch。 */
  value: unknown;
  /** 顶层 label，默认 "root"。 */
  rootLabel?: string;
  /** 自动展开的最大深度，默认 1。 */
  defaultExpandDepth?: number;
}

export function JsonTreeView({
  value,
  rootLabel = "root",
  defaultExpandDepth = 1,
}: JsonTreeViewProps) {
  return (
    <div className="json-tree" role="tree">
      <JsonNode
        nodeKey={rootLabel}
        value={value}
        depth={0}
        defaultExpandDepth={defaultExpandDepth}
        isRoot
      />
    </div>
  );
}

function JsonNode({
  nodeKey,
  value,
  depth,
  defaultExpandDepth,
  isRoot = false,
}: {
  nodeKey: string;
  value: unknown;
  depth: number;
  defaultExpandDepth: number;
  isRoot?: boolean;
}) {
  const isObject = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);
  const [expanded, setExpanded] = useState<boolean>(depth < defaultExpandDepth);

  if (!isObject) {
    return (
      <div
        className="json-tree-row json-tree-leaf"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <span className="json-tree-spacer" aria-hidden="true" />
        {!isRoot && <span className="json-tree-key">{nodeKey}:</span>}
        <JsonLeafValue value={value} />
      </div>
    );
  }

  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const sizeText = isArray
    ? `[ ${entries.length} item${entries.length === 1 ? "" : "s"} ]`
    : `{ ${entries.length} key${entries.length === 1 ? "" : "s"} }`;

  return (
    <div className="json-tree-group">
      <div
        className="json-tree-row json-tree-container"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => setExpanded((prev) => !prev)}
        role="treeitem"
        aria-expanded={expanded}
      >
        <ChevronRight
          size={11}
          className={`json-tree-chevron ${expanded ? "is-open" : ""}`}
          aria-hidden="true"
        />
        {!isRoot && <span className="json-tree-key">{nodeKey}:</span>}
        <span className="json-tree-summary">{sizeText}</span>
      </div>
      {expanded && (
        <div className="json-tree-children" role="group">
          {entries.length === 0 ? (
            <div
              className="json-tree-row json-tree-empty"
              style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }}
            >
              <span className="muted small">(empty)</span>
            </div>
          ) : (
            entries.map(([k, v]) => (
              <JsonNode
                key={k}
                nodeKey={k}
                value={v}
                depth={depth + 1}
                defaultExpandDepth={defaultExpandDepth}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function JsonLeafValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="json-tree-value json-tree-null">null</span>;
  }
  if (typeof value === "string") {
    return (
      <span className="json-tree-value json-tree-string" title={value}>
        "{value.length > 200 ? value.slice(0, 200) + "…" : value}"
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="json-tree-value json-tree-number">{value}</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className="json-tree-value json-tree-bool">{value ? "true" : "false"}</span>
    );
  }
  return <span className="json-tree-value">{String(value)}</span>;
}
