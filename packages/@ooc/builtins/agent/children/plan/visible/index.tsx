import type { Data, PlanWindowStep } from "../types.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class";
import { objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import React from "react";
import { CheckCircle2, Circle, CircleDot, CircleSlash } from "lucide-react";
import { MarkdownContent } from "@ooc/web/src/shared/ui/MarkdownContent";
import { dispatchNavigateToWindow } from "@ooc/web/src/domains/files/navigation-events";

/** Plan window 详情面板（业务字段读自实例 `data`）。 */
export default function PlanWindowDetail({ window }: { window: OocObjectInstance<Data> }) {
  const data = objectDataOf(window);
  const total = data.steps.length;
  const doneN = data.steps.filter((s) => s.status === "done").length;
  const isArchived = data.status === "archived";

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
          <span className="llm-input-attr-value">{data.title}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">progress</span>
          <span className="llm-input-attr-value">
            {doneN}/{total} done
          </span>
        </div>
      </div>

      {data.description && (
        <div className="cw-plan-description" style={{ marginBottom: 12 }}>
          <MarkdownContent content={data.description} />
        </div>
      )}

      <h3 style={{ marginTop: 8 }}>
        Steps ({doneN}/{total} done)
      </h3>
      {total === 0 ? (
        <div className="llm-input-empty">该 plan 尚未添加 step。</div>
      ) : (
        <ul className="cw-plan-step-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {data.steps.map((step: PlanWindowStep) => (
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

      {data.parentPlanWindowId && (
        <div className="cw-plan-parent-link" style={{ marginTop: 12 }}>
          <span className="muted small">Parent: </span>
          <button
            type="button"
            className="cw-plan-parent-link-btn"
            onClick={() => dispatchNavigateToWindow(data.parentPlanWindowId!)}
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
            {data.parentPlanWindowId}
          </button>
          {data.parentStepId && (
            <span className="muted small"> at step {data.parentStepId}</span>
          )}
        </div>
      )}
    </div>
  );
}

export { PlanWindowDetail as WindowDetail };
