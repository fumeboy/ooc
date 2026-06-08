/**
 * RelationDiff — relation_window 的 visible/diff 组件（线 C）。
 *
 * 逻辑来自 window-diff-renderers/RelationWindowDiff.tsx，
 * 签名收敛到 WindowDiffProps ({previous, current})，删去 windowId 引用。
 *
 * Diff 形态：
 *   - peer 字段 diff（peerId / status / selfLongTermPath / selfSessionPath）
 *   - selfLongTermBody（object scope）Markdown body diff
 *   - selfSessionBody（flow scope）Markdown body diff
 */

import type { WindowDiffProps } from "./window-diff-props";
import { FieldDiffLine, Section, asRecord, readString } from "../window-diff-renderers/_shared";
import { MarkdownBodyDiff } from "../window-diff-renderers/MarkdownBodyDiff";

export default function RelationDiff({ previous, current }: WindowDiffProps) {
  const prev = asRecord(previous);
  const cur = asRecord(current);

  const prevLongTerm = readString(prev, "selfLongTermBody") ?? "";
  const curLongTerm = readString(cur, "selfLongTermBody") ?? "";

  const prevSession = readString(prev, "selfSessionBody") ?? "";
  const curSession = readString(cur, "selfSessionBody") ?? "";

  return (
    <div data-testid="relation-window-diff">
      <Section title="peer" testId="relation-fields">
        <FieldDiffLine label="peerId" prev={readString(prev, "peerId")} cur={readString(cur, "peerId")} />
        <FieldDiffLine label="status" prev={readString(prev, "status")} cur={readString(cur, "status")} />
        <FieldDiffLine
          label="selfLongTermPath"
          prev={readString(prev, "selfLongTermPath")}
          cur={readString(cur, "selfLongTermPath")}
        />
        <FieldDiffLine
          label="selfSessionPath"
          prev={readString(prev, "selfSessionPath")}
          cur={readString(cur, "selfSessionPath")}
        />
      </Section>
      <Section title="selfLongTermBody (object scope)" testId="relation-long">
        {prevLongTerm === "" && curLongTerm === "" ? (
          <div className="muted small">(empty)</div>
        ) : (
          <MarkdownBodyDiff
            previousBody={prevLongTerm}
            currentBody={curLongTerm}
            testId="relation-long-diff"
          />
        )}
      </Section>
      <Section title="selfSessionBody (flow scope)" testId="relation-session">
        {prevSession === "" && curSession === "" ? (
          <div className="muted small">(empty)</div>
        ) : (
          <MarkdownBodyDiff
            previousBody={prevSession}
            currentBody={curSession}
            testId="relation-session-diff"
          />
        )}
      </Section>
    </div>
  );
}
