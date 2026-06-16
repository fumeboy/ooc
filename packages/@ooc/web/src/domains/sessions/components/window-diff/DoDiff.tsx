/**
 * DoDiff — do_window 的 visible/diff 组件（线 C）。
 *
 * 逻辑来自 window-diff-renderers/DoWindowDiff.tsx，
 * 签名收敛到 WindowDiffProps ({previous, current})，删去 windowId 引用。
 *
 * Diff 形态：
 *   - status 变化（running → archived 用大字号）
 *   - targetThreadId 变化
 *   - title 字段 diff（creator 窗身份已编码在 id，不再有 isCreatorWindow data 字段可 diff）
 */

import type { WindowDiffProps } from "./window-diff-props";
import {
  FieldDiffLine,
  Section,
  StatusBadge,
  asRecord,
  comparePrimitive,
  readString,
  rowStyle,
} from "../window-diff-renderers/_shared";

export default function DoDiff({ previous, current }: WindowDiffProps) {
  const prev = asRecord(previous);
  const cur = asRecord(current);

  const prevStatus = readString(prev, "status");
  const curStatus = readString(cur, "status");
  const statusDiff = comparePrimitive(prevStatus, curStatus);

  return (
    <div data-testid="do-window-diff">
      <Section title="child status" testId="do-status">
        <div
          data-diff-status={statusDiff}
          style={{
            ...rowStyle(statusDiff),
            fontSize: 14,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {statusDiff === "changed" ? (
            <>
              <code>{prevStatus ?? "(none)"}</code>
              <span>→</span>
              <code>{curStatus ?? "(none)"}</code>
            </>
          ) : (
            <code>{curStatus ?? prevStatus ?? "(none)"}</code>
          )}
          <StatusBadge status={statusDiff} />
        </div>
      </Section>
      <Section title="fields" testId="do-fields">
        <FieldDiffLine
          label="targetThreadId"
          prev={readString(prev, "targetThreadId")}
          cur={readString(cur, "targetThreadId")}
        />
        <FieldDiffLine label="title" prev={readString(prev, "title")} cur={readString(cur, "title")} />
      </Section>
    </div>
  );
}
