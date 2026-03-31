/**
 * InlineNode - 内联节点组件
 *
 * 展示 inline_before、inline_after、inline_reflect 类型的节点。
 * 使用浅色背景区分类型，嵌入在父节点的展开内容中。
 */
import { ActionCard } from "./ActionCard";
import type { ProcessNode, NodeType } from "../../api/types";

interface InlineNodeProps {
  node: ProcessNode;
}

type InlineNodeType = "inline_before" | "inline_after" | "inline_reflect";

// 内联节点类型样式映射
const INLINE_TYPE_STYLES: Record<InlineNodeType, {
  bg: string;
  border: string;
  headerBg: string;
  text: string;
  label: string;
}> = {
  inline_before: {
    bg: "#fffbeb",
    border: "#fde68a",
    headerBg: "#fef3c7",
    text: "#92400e",
    label: "before",
  },
  inline_after: {
    bg: "#ecfdf5",
    border: "#a7f3d0",
    headerBg: "#d1fae5",
    text: "#065f46",
    label: "after",
  },
  inline_reflect: {
    bg: "#faf5ff",
    border: "#e9d5ff",
    headerBg: "#f3e8ff",
    text: "#6b21a8",
    label: "reflect",
  },
};

function isInlineType(type: NodeType): type is InlineNodeType {
  return type === "inline_before" || type === "inline_after" || type === "inline_reflect";
}

export function InlineNode({ node }: InlineNodeProps) {
  const nodeType = (node.type || "frame") as NodeType;
  const style = isInlineType(nodeType)
    ? INLINE_TYPE_STYLES[nodeType]
    : INLINE_TYPE_STYLES.inline_before;

  return (
    <div
      className="rounded-lg mb-4 overflow-hidden border"
      style={{
        backgroundColor: style.bg,
        borderColor: style.border,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b text-xs font-semibold"
        style={{
          backgroundColor: style.headerBg,
          borderColor: style.border,
          color: style.text,
        }}
      >
        <div className="flex items-center">
          <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: style.text }} />
          [inline/{style.label}] {node.title}
        </div>
        <span className="px-2 py-0.5 rounded text-xs">
          {nodeType === "inline_before" || nodeType === "inline_after" ? "hook 自动" : "主动"}
        </span>
      </div>

      {/* Actions 时间线 */}
      {node.actions.length > 0 && (
        <div className="px-4 py-3">
          {node.actions.map((action, i) => (
            <ActionCard key={i} action={action} maxHeight={200} />
          ))}
        </div>
      )}

      {/* Footer */}
      {node.summary && (
        <div
          className="px-3 py-1.5 border-t text-xs"
          style={{
            backgroundColor: style.headerBg,
            borderColor: style.border,
            color: style.text,
          }}
        >
          [inline/{style.label}_end] &nbsp;
          <strong>summary:</strong> {node.summary}
        </div>
      )}
    </div>
  );
}
