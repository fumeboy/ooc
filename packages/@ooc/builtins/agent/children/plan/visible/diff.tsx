/**
 * plan/visible/diff.tsx — plan_window 的 visible/diff 组件（线 C）。
 *
 * 逻辑来自 packages/@ooc/web/src/domains/sessions/components/window-diff-renderers/PlanWindowDiff.tsx，
 * 签名收敛到 WindowDiffProps ({previous, current})，删去 windowId 引用。
 *
 * Diff 形态：
 *   - title / description 文本字段 diff
 *   - status: active | done | archived
 *   - steps: 按 step.id 配对
 *       added → 绿底
 *       removed → strike
 *       status change → 黄底 + "pending → done" 等
 *       text change → inline diff
 *       subPlanWindowId change → "sub plan link added/removed"
 */

import type { WindowDiffProps } from "@ooc/web/src/domains/sessions/components/window-diff/window-diff-props";
import {
  FieldDiffLine,
  Section,
  StatusBadge,
  asRecord,
  comparePrimitive,
  readArray,
  readString,
  rowStyle,
  type DiffStatus,
} from "@ooc/web/src/domains/sessions/components/window-diff-renderers/_shared";

type StepLike = {
  id?: string;
  text?: string;
  status?: string;
  subPlanWindowId?: string;
};

function asStep(v: unknown): StepLike {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  return {
    id: typeof o.id === "string" ? o.id : undefined,
    text: typeof o.text === "string" ? o.text : undefined,
    status: typeof o.status === "string" ? o.status : undefined,
    subPlanWindowId:
      typeof o.subPlanWindowId === "string" ? o.subPlanWindowId : undefined,
  };
}

function stepDiffStatus(prev: StepLike | undefined, cur: StepLike): DiffStatus {
  if (!prev) return "added";
  if (
    prev.text === cur.text &&
    prev.status === cur.status &&
    prev.subPlanWindowId === cur.subPlanWindowId
  )
    return "unchanged";
  return "changed";
}

export default function PlanWindowDiff({ previous, current }: WindowDiffProps) {
  const prev = asRecord(previous);
  const cur = asRecord(current);

  const prevSteps = readArray(prev, "steps").map(asStep);
  const curSteps = readArray(cur, "steps").map(asStep);

  const prevById = new Map<string, { step: StepLike; index: number }>();
  prevSteps.forEach((s, i) => {
    if (s.id) prevById.set(s.id, { step: s, index: i });
  });
  const usedPrevIds = new Set<string>();
  const usedPrevIndexes = new Set<number>();

  const rows: React.ReactNode[] = [];
  curSteps.forEach((cs, i) => {
    let prevStep: StepLike | undefined;
    if (cs.id && prevById.has(cs.id)) {
      prevStep = prevById.get(cs.id)!.step;
      usedPrevIds.add(cs.id);
    } else if (!cs.id && i < prevSteps.length) {
      prevStep = prevSteps[i];
      usedPrevIndexes.add(i);
    }
    const status = stepDiffStatus(prevStep, cs);
    rows.push(
      <div key={`step-cur-${i}`} style={rowStyle(status)} data-diff-status={status} data-step-id={cs.id}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <strong>step #{i}</strong>
          {cs.id && <code className="muted small">{cs.id}</code>}
          <StatusBadge status={status} />
        </div>
        <div>
          <strong>status:</strong>{" "}
          {prevStep && comparePrimitive(prevStep.status, cs.status) === "changed" ? (
            <>
              <code>{prevStep.status ?? "(none)"}</code>
              <span> → </span>
              <code>{cs.status ?? "(none)"}</code>
            </>
          ) : (
            <code>{cs.status ?? "(none)"}</code>
          )}
        </div>
        <div>
          <strong>text:</strong>{" "}
          {prevStep && comparePrimitive(prevStep.text, cs.text) === "changed" ? (
            <>
              <span style={{ textDecoration: "line-through", opacity: 0.7 }}>
                {prevStep.text ?? "(empty)"}
              </span>
              <span style={{ margin: "0 4px" }}>→</span>
              <span>{cs.text ?? "(empty)"}</span>
            </>
          ) : (
            <span>{cs.text ?? "(empty)"}</span>
          )}
        </div>
        {(prevStep?.subPlanWindowId !== cs.subPlanWindowId) && (
          <div className="muted small" style={{ marginTop: 2 }}>
            sub plan link:{" "}
            {!prevStep?.subPlanWindowId && cs.subPlanWindowId && (
              <em>added → {cs.subPlanWindowId}</em>
            )}
            {prevStep?.subPlanWindowId && !cs.subPlanWindowId && (
              <em>removed (was {prevStep.subPlanWindowId})</em>
            )}
            {prevStep?.subPlanWindowId && cs.subPlanWindowId && (
              <em>
                {prevStep.subPlanWindowId} → {cs.subPlanWindowId}
              </em>
            )}
          </div>
        )}
      </div>,
    );
  });

  // 未被使用的 prev step → removed
  prevSteps.forEach((s, i) => {
    if (s.id && usedPrevIds.has(s.id)) return;
    if (!s.id && usedPrevIndexes.has(i)) return;
    rows.push(
      <div
        key={`step-removed-${i}`}
        style={rowStyle("removed")}
        data-diff-status="removed"
        data-step-id={s.id}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <strong>step #{i}</strong>
          {s.id && <code className="muted small">{s.id}</code>}
          <StatusBadge status="removed" />
        </div>
        <div>{s.text ?? "(empty)"}</div>
      </div>,
    );
  });

  return (
    <div data-testid="plan-window-diff">
      <Section title="plan fields" testId="plan-fields">
        <FieldDiffLine label="title" prev={readString(prev, "title")} cur={readString(cur, "title")} />
        <FieldDiffLine
          label="description"
          prev={readString(prev, "description")}
          cur={readString(cur, "description")}
        />
        <FieldDiffLine label="status" prev={readString(prev, "status")} cur={readString(cur, "status")} />
      </Section>
      <Section
        title={`steps (${curSteps.length} cur · ${prevSteps.length} prev)`}
        testId="plan-steps"
      >
        {rows.length === 0 ? <div className="muted small">(no steps)</div> : rows}
      </Section>
    </div>
  );
}
