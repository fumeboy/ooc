/**
 * NodeCard - 单个节点卡片组件
 *
 * 展示单个 ProcessNode 的完整信息，支持折叠/展开。
 * 折叠时：只展示 plan、input、outputs 标记、summary
 * 展开时：展示完整 events 时间线、内联节点
 */
import { useState } from "react";
import { cn } from "../../lib/utils";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { ProcessNode } from "../../api/types";
import { InlineNode } from "./InlineNode";
import { TuiAction } from "./TuiBlock";

interface NodeCardProps {
  node: ProcessNode;
  /** 是否默认展开 */
  defaultExpanded?: boolean;
  /** 是否为当前 focus 节点 */
  isFocus?: boolean;
  /** 点击展开/展开回调 */
  onToggle?: () => void;
}

// 状态颜色
const STATUS_COLORS = {
  done: "#22c55e",
  doing: "#f59e0b",
  waiting: "#f59e0b",
  failed: "#ef4444",
  todo: "#d1d5db",
};

const STATUS_BADGE_COLORS = {
  done: { bg: "#dcfce7", text: "#166534" },
  doing: { bg: "#dbeafe", text: "#1d4ed8" },
  waiting: { bg: "#fef3c7", text: "#92400e" },
  failed: { bg: "#fee2e2", text: "#991b1b" },
  todo: { bg: "#f3f4f6", text: "#6b7280" },
};

export function NodeCard({ node, defaultExpanded = false, isFocus = false, onToggle }: NodeCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const handleToggle = () => {
    setExpanded(!expanded);
    onToggle?.();
  };

  const statusColor = STATUS_COLORS[node.status];
  const badgeColor = STATUS_BADGE_COLORS[node.status];

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white mb-4">
      {/* Header */}
      <div
        className="flex items-center px-3.5 py-2.5 bg-gray-50 border-b border-gray-100 cursor-pointer"
        onClick={handleToggle}
      >
        {/* 折叠/展开按钮 */}
        <span className="mr-2 text-gray-500 text-base">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        {/* 状态 dot */}
        <span
          className="w-2.5 h-2.5 rounded-full mr-2.5"
          style={{
            backgroundColor: statusColor,
            animation: node.status === "doing" ? "pulse 2s infinite" : "none"
          }}
        />

        {/* 标题 */}
        <span className={cn("font-semibold text-gray-900", isFocus && "text-blue-600")}>
          {node.title}
        </span>

        {/* 状态 badge */}
        <span
          className="ml-3 px-2 py-0.5 rounded-full text-xs"
          style={{ backgroundColor: badgeColor.bg, color: badgeColor.text }}
        >
          {node.status}
        </span>

        {/* Actions 数量 */}
        {node.events.length > 0 && (
          <span className="ml-auto text-xs text-gray-400">
            {node.events.length} {node.events.length === 1 ? "event" : "events"}
          </span>
        )}
      </div>

      {/* 内容区域 */}
      <div className="px-4 py-3">
        {/* [plan] 区域 */}
        {node.plan && (
          <div className="mb-3 pl-1 border-l-2 border-purple-500">
            <div className="text-xs text-purple-700 font-semibold mb-1">[plan]</div>
            <div className="text-sm text-purple-900 leading-relaxed whitespace-pre-wrap">
              {node.plan}
            </div>
          </div>
        )}

        {/* 分隔线 */}
        {(node.plan || expanded) && <div className="h-px bg-gray-100 my-3" />}

        {/* 折叠状态内容 */}
        {!expanded ? (
          <CollapsedContent node={node} />
        ) : (
          <ExpandedContent node={node} />
        )}
      </div>

      {/* 内联样式：pulse 动画 */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

/* ── 折叠状态内容 ── */
function CollapsedContent({ node }: { node: ProcessNode }) {
  const hasInlineChildren = node.children.some(c => c.type && c.type !== "frame");
  const hasRegularChildren = node.children.some(c => !c.type || c.type === "frame");

  return (
    <>
      {/* Input 区域 */}
      <div className="mb-3">
        <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Input</div>
        <div className="text-sm text-gray-700 leading-relaxed">
          <div><strong>title:</strong> {node.title}</div>
          {node.description && (
            <div className="mt-1 text-gray-500"><strong>description:</strong> {node.description}</div>
          )}
          {node.traits && node.traits.length > 0 && (
            <div className="mt-1"><strong>traits:</strong> {node.traits.join(", ")}</div>
          )}
        </div>
      </div>

      {/* Outputs 区域 */}
      {node.outputs && node.outputs.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between py-1 cursor-pointer">
            <div className="flex items-center">
              <span className="text-xs text-green-700 font-semibold">Outputs</span>
              <span
                className="ml-2 px-2 py-0.5 rounded-full text-xs"
                style={{ backgroundColor: "#dcfce7", color: "#166534" }}
              >
                {node.outputs.join(", ")}
              </span>
            </div>
            <ChevronDown className="w-4 h-4 text-gray-500" />
          </div>
        </div>
      )}

      {/* 内联节点标记 */}
      {hasInlineChildren && (
        <div className="mb-3 px-3 py-1.5 rounded text-xs flex items-center justify-between" style={{ backgroundColor: "#fffbeb" }}>
          <div className="flex items-center">
            <span className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: "#f59e0b" }} />
            <span className="font-semibold text-amber-800">[inline]</span>
            <span className="ml-1.5 text-amber-700">
              {node.children.filter(c => c.type && c.type !== "frame").map(c => c.title).join(", ")}
            </span>
          </div>
          <span className="text-amber-700">→</span>
        </div>
      )}

      {/* Actions 折叠标记 */}
      {(node.events.length > 0 || hasRegularChildren) && (
        <div className="mb-3 px-3 py-1.5 rounded text-xs text-center text-gray-500" style={{ backgroundColor: "#fafafa" }}>
          <span className="font-medium">
            [{node.events.length} 个 events
            {hasRegularChildren && ` + ${node.children.filter(c => !c.type || c.type === "frame").length} 个子节点`}]
          </span>
          <span className="ml-2">(点击展开)</span>
        </div>
      )}

      {/* 分隔线 */}
      {node.summary && <div className="h-px bg-gray-100 my-3" />}

      {/* Summary 区域 */}
      {node.summary && (
        <div>
          <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Summary</div>
          <div className="text-sm text-gray-700 leading-relaxed pl-1 border-l-2 border-gray-200 whitespace-pre-wrap">
            {node.summary}
            {node.locals && Object.keys(node.locals).length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-400">
                <strong>artifacts:</strong> {Object.keys(node.locals).join(", ")}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ── 展开状态内容 ── */
function ExpandedContent({ node }: { node: ProcessNode }) {
  // 区分子节点类型
  const inlineChildren = node.children.filter(c => c.type && c.type !== "frame");
  const regularChildren = node.children.filter(c => !c.type || c.type === "frame");

  return (
    <>
      {/* Input 区域 */}
      <div className="mb-3">
        <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Input</div>
        <div className="text-sm text-gray-700 leading-relaxed">
          <div><strong>title:</strong> {node.title}</div>
          {node.description && (
            <div className="mt-1 text-gray-500"><strong>description:</strong> {node.description}</div>
          )}
          {node.traits && node.traits.length > 0 && (
            <div className="mt-1"><strong>traits:</strong> {node.traits.join(", ")}</div>
          )}
          {node.outputs && node.outputs.length > 0 && (
            <div className="mt-1"><strong>outputs:</strong> {node.outputs.join(", ")}</div>
          )}
          {node.outputDescription && (
            <div className="mt-1 text-gray-500"><strong>outputDescription:</strong> {node.outputDescription}</div>
          )}
        </div>
      </div>

      {/* 分隔线 */}
      <div className="h-px bg-gray-100 my-3" />

      {/* 内联节点（嵌入在 Actions 之前） */}
      {inlineChildren.length > 0 && (
        <div className="mb-3">
          {inlineChildren.map(child => (
            <InlineNode key={child.id} node={child} />
          ))}
        </div>
      )}

      {/* Actions 时间线 */}
      {node.events.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-500 uppercase font-semibold mb-2">Actions 时间线</div>
          <div className="border-l-2 border-gray-200 ml-3 pl-4 space-y-3">
            {node.events.map((action, i) => (
              <TuiAction key={i} action={action} maxHeight={200} />
            ))}
          </div>
        </div>
      )}

      {/* 普通子节点 */}
      {regularChildren.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-500 uppercase font-semibold mb-2">子节点</div>
          {regularChildren.map(child => (
            <NodeCard key={child.id} node={child} defaultExpanded={false} />
          ))}
        </div>
      )}

      {/* 分隔线 */}
      {node.summary && <div className="h-px bg-gray-100 my-3" />}

      {/* Summary 区域 */}
      {node.summary && (
        <div>
          <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Summary</div>
          <div className="text-sm text-gray-700 leading-relaxed pl-1 border-l-2 border-gray-200 whitespace-pre-wrap">
            {node.summary}
            {node.locals && Object.keys(node.locals).length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-400">
                <strong>artifacts:</strong> {Object.keys(node.locals).join(", ")}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
