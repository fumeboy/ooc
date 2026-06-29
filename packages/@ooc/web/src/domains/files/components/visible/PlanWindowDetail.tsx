/**
 * Plan window 详情面板（视觉体）。
 *
 * Phase 1 read-only:attrs 区展示 title / status / description / step 状态分布,
 * steps 列表用 status icon + text 行式渲染,sub plan / parent plan 仅以文本提示。
 * 签名对齐其他 visible 组件 `({ window }: { window: ContextWindow }) => JSX`,
 * 不带 callMethod,后续 Phase 2 才接 step 流转交互。
 */
import React from "react";
import type { ContextWindow } from "../../context-snapshot";

type PlanWindow = Extract<ContextWindow, { class: "plan" }>;
type PlanStep = PlanWindow["steps"][number];

function stepStatusIcon(status: PlanStep["status"]): string {
  switch (status) {
    case "pending": return "○";
    case "in-progress": return "◐";
    case "done": return "●";
    case "blocked": return "✕";
    default: return "?";
  }
}

export default function PlanWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as PlanWindow;
  const counts = { pending: 0, "in-progress": 0, done: 0, blocked: 0 };
  for (const s of w.steps) counts[s.status] += 1;
  const createdAt = w.createdAt ? new Date(w.createdAt).toLocaleString() : null;
  const hasParent = w.parentPlanWindowId || w.parentStepId;
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">title</span>
          <span className="llm-input-attr-value">{w.title}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">status</span>
          <span className="llm-input-attr-value">
            <span data-status={w.status}>{w.status}</span>
          </span>
        </div>
        {w.description && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">description</span>
            <span className="llm-input-attr-value">{w.description}</span>
          </div>
        )}
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">steps</span>
          <span className="llm-input-attr-value">
            {w.steps.length} total
            <span className="muted small">
              {" "}· pending {counts.pending} · in-progress {counts["in-progress"]} · done {counts.done} · blocked {counts.blocked}
            </span>
          </span>
        </div>
        {hasParent && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">parent plan</span>
            <span className="llm-input-attr-value">
              {w.parentPlanWindowId ?? "(none)"}
              {w.parentStepId && (
                <span className="muted small"> · step {w.parentStepId}</span>
              )}
            </span>
          </div>
        )}
        {createdAt && (
          <div className="llm-input-attr-row">
            <span className="llm-input-attr-key">created</span>
            <span className="llm-input-attr-value">{createdAt}</span>
          </div>
        )}
      </div>
      {w.steps.length === 0 ? (
        <div className="llm-input-empty">尚无 step。</div>
      ) : (
        <ul className="cw-plan-step-list">
          {w.steps.map((s) => (
            <li key={s.id} className="cw-plan-step-row">
              <span className="cw-plan-step-icon" data-status={s.status} aria-hidden="true">
                {stepStatusIcon(s.status)}
              </span>
              <span className="cw-plan-step-text">{s.text}</span>
              {s.subPlanWindowId && (
                <span className="muted small">↳ 子计划 {s.subPlanWindowId}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
