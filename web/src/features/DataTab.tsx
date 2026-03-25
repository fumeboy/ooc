/**
 * DataTab —— 对象数据展示（data 键值对）
 *
 * @ref docs/哲学文档/gene.md#G1 — renders — 对象的 data 动态键值对
 * @ref docs/哲学文档/gene.md#G11 — implements — 对象 UI 自我表达
 */
import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { CodeBlock } from "../components/ui/CodeBlock";

interface DataTabProps {
  data: Record<string, unknown>;
}

export function DataTab({ data }: DataTabProps) {
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">(暂无数据)</p>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
            <th className="text-left px-4 py-2 font-medium">Key</th>
            <th className="text-left px-4 py-2 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-b border-[var(--border)] last:border-0">
              <td className="px-4 py-2 font-mono text-xs align-top">{key}</td>
              <td className="px-4 py-2">
                <ValueDisplay value={value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ValueDisplay({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);

  if (value === null || value === undefined) {
    return <span className="text-[var(--muted-foreground)] text-xs">null</span>;
  }

  if (typeof value === "string") {
    return <span className="text-xs">"{value}"</span>;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-xs font-mono">{String(value)}</span>;
  }

  /* 复杂值：折叠展示 */
  const jsonStr = JSON.stringify(value, null, 2);
  const isLong = jsonStr.length > 80;

  if (!isLong) {
    return <span className="text-xs font-mono">{jsonStr}</span>;
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {Array.isArray(value) ? `Array(${value.length})` : "Object"}
      </button>
      {expanded && (
        <CodeBlock maxHeight="max-h-60" className="mt-1">{jsonStr}</CodeBlock>
      )}
    </div>
  );
}
