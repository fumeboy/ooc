/**
 * DoWindowDiff — do_window 的 diff renderer。
 *
 * 突出显示：
 *   - status 变化（running → archived 用大字号）
 *   - targetThreadId 变化（一般不应该变；变了 = bug 信号）
 *   - title 变化
 *   - isCreatorWindow 标记
 *
 * 不挖 transcript（do_window transcript 由 inbox/outbox 过滤而来；snapshot 上
 * 不直接挂；这里聚焦字段级 diff）。
 */

import type { WindowDiffRendererProps } from "./registry";
import {
  FieldDiffLine,
  Section,
  StatusBadge,
  asRecord,
  comparePrimitive,
  readString,
  rowStyle,
} from "./_shared";

export function DoWindowDiff(props: WindowDiffRendererProps) {
  const { previous, current, windowId } = props;
  const prev = asRecord(previous);
  const cur = asRecord(current);

  const prevStatus = readString(prev, "status");
  const curStatus = readString(cur, "status");
  const statusDiff = comparePrimitive(prevStatus, curStatus);

  return (
    <div data-testid={`do-window-diff-${windowId}`}>
      <Section title="child status" testId={`do-status-${windowId}`}>
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
      <Section title="fields" testId={`do-fields-${windowId}`}>
        <FieldDiffLine
          label="targetThreadId"
          prev={readString(prev, "targetThreadId")}
          cur={readString(cur, "targetThreadId")}
        />
        <FieldDiffLine label="title" prev={readString(prev, "title")} cur={readString(cur, "title")} />
        <FieldDiffLine
          label="isCreatorWindow"
          prev={(prev as Record<string, unknown>).isCreatorWindow}
          cur={(cur as Record<string, unknown>).isCreatorWindow}
        />
      </Section>
    </div>
  );
}
