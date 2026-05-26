/**
 * RelationWindowDiff — relation_window 的双 scope body diff（design § 4.9）。
 *
 * relation_window 持有：
 *   - selfLongTermBody（long-term 对该 peer 的 relation note，object 级）
 *   - selfSessionBody（本 session 内的 relation note，flow 级）
 *
 * 两块 body 各用 MarkdownBodyDiff（CodeMirror Merge unified）渲染。
 */

import type { WindowDiffRendererProps } from "./registry";
import { FieldDiffLine, Section, asRecord, readString } from "./_shared";
import { MarkdownBodyDiff } from "./MarkdownBodyDiff";

export function RelationWindowDiff(props: WindowDiffRendererProps) {
  const { previous, current, windowId } = props;
  const prev = asRecord(previous);
  const cur = asRecord(current);

  const prevLongTerm = readString(prev, "selfLongTermBody") ?? "";
  const curLongTerm = readString(cur, "selfLongTermBody") ?? "";

  const prevSession = readString(prev, "selfSessionBody") ?? "";
  const curSession = readString(cur, "selfSessionBody") ?? "";

  return (
    <div data-testid={`relation-window-diff-${windowId}`}>
      <Section title="peer" testId={`relation-fields-${windowId}`}>
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
      <Section title="selfLongTermBody (object scope)" testId={`relation-long-${windowId}`}>
        {prevLongTerm === "" && curLongTerm === "" ? (
          <div className="muted small">(empty)</div>
        ) : (
          <MarkdownBodyDiff
            previousBody={prevLongTerm}
            currentBody={curLongTerm}
            testId={`relation-long-diff-${windowId}`}
          />
        )}
      </Section>
      <Section title="selfSessionBody (flow scope)" testId={`relation-session-${windowId}`}>
        {prevSession === "" && curSession === "" ? (
          <div className="muted small">(empty)</div>
        ) : (
          <MarkdownBodyDiff
            previousBody={prevSession}
            currentBody={curSession}
            testId={`relation-session-diff-${windowId}`}
          />
        )}
      </Section>
    </div>
  );
}
