/**
 * EditPlanView —— 展示单个 Edit Plan（多文件原子编辑事务）的 UI
 *
 * MVP：给定 plan 对象（通常由 trait 方法返回或从 HTTP endpoint 拉取后传入），
 * 渲染每个 change 的 unified diff。后续可扩展"查看 diff / 应用"按钮，
 * 但 HTTP 端点注入需要 Running-Summary-Agent 落地 server.ts 之后再接，本组件先纯展示。
 *
 * 输入 prop 结构：{ plan, preview, onApply?, onCancel? }
 */

import { useMemo } from "react";

/** 与后端 EditPlan 的最小子集保持一致 */
export interface EditPlanViewModel {
  planId: string;
  status: "pending" | "applied" | "failed" | "cancelled";
  createdAt: number;
  changes: Array<{
    kind: "edit" | "write";
    path: string;
    oldText?: string;
    newText?: string;
    newContent?: string;
    replaceAll?: boolean;
  }>;
}

interface Props {
  plan: EditPlanViewModel;
  /** 由后端 previewEditPlan 返回的 unified-diff 字符串 */
  preview: string;
  /** 可选：用户点击"应用"。组件本身不关心具体实现 */
  onApply?: (planId: string) => void;
  /** 可选：用户点击"取消" */
  onCancel?: (planId: string) => void;
}

/** 把 preview 按"--- a/path"分段为多个 file block */
function splitPreviewByFile(preview: string): Array<{ path: string; body: string }> {
  const lines = preview.split("\n");
  const blocks: Array<{ path: string; body: string[] }> = [];
  let current: { path: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(/^--- a\/(.+)$/);
    if (m) {
      if (current) blocks.push(current);
      current = { path: m[1]!, body: [] };
      continue;
    }
    if (line.startsWith("+++ b/")) continue;
    if (current) current.body.push(line);
  }
  if (current) blocks.push(current);
  return blocks.map((b) => ({ path: b.path, body: b.body.join("\n") }));
}

/** 单行 diff 的颜色 */
function lineClass(line: string): string {
  if (line.startsWith("+")) return "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20";
  if (line.startsWith("-")) return "text-rose-600 bg-rose-50 dark:bg-rose-900/20";
  if (line.startsWith("@@")) return "text-slate-500 italic";
  return "text-slate-700 dark:text-slate-300";
}

export function EditPlanView({ plan, preview, onApply, onCancel }: Props) {
  const fileBlocks = useMemo(() => splitPreviewByFile(preview), [preview]);

  const statusColor =
    plan.status === "pending"
      ? "bg-amber-500"
      : plan.status === "applied"
      ? "bg-emerald-500"
      : plan.status === "failed"
      ? "bg-rose-500"
      : "bg-slate-500";

  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-sm font-medium">Edit Plan {plan.planId}</span>
          <span className="text-xs text-slate-500">
            · {plan.changes.length} 个文件 · {plan.status}
          </span>
        </div>
        {plan.status === "pending" && (onApply || onCancel) && (
          <div className="flex items-center gap-2">
            {onCancel && (
              <button
                type="button"
                onClick={() => onCancel(plan.planId)}
                className="text-xs px-3 py-1 rounded border border-slate-300 hover:bg-slate-50"
              >
                取消
              </button>
            )}
            {onApply && (
              <button
                type="button"
                onClick={() => onApply(plan.planId)}
                className="text-xs px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
              >
                应用
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {fileBlocks.map((b, i) => (
          <div key={`${b.path}-${i}`} className="border rounded overflow-hidden">
            <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-xs font-mono">
              {b.path}
            </div>
            <pre className="text-xs font-mono p-2 overflow-x-auto whitespace-pre">
              {b.body.split("\n").map((line, j) => (
                <div key={j} className={lineClass(line)}>
                  {line || " "}
                </div>
              ))}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
