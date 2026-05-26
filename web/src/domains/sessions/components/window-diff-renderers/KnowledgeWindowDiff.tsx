/**
 * KnowledgeWindowDiff — knowledge_window 的 frontmatter + body diff（design § 4.6）。
 *
 * - frontmatter 字段级 JSON diff
 * - body 用 MarkdownBodyDiff（CodeMirror Merge unified） 行级 diff
 */

import type { WindowDiffRendererProps } from "./registry";
import {
  FieldDiffLine,
  Section,
  asRecord,
  readObject,
  readString,
} from "./_shared";
import { MarkdownBodyDiff } from "./MarkdownBodyDiff";

export function KnowledgeWindowDiff(props: WindowDiffRendererProps) {
  const { previous, current, windowId } = props;
  const prev = asRecord(previous);
  const cur = asRecord(current);

  const prevBody = readString(prev, "body") ?? "";
  const curBody = readString(cur, "body") ?? "";

  const prevFm = readObject(prev, "frontmatter") ?? {};
  const curFm = readObject(cur, "frontmatter") ?? {};
  const fmKeys = new Set<string>([
    ...Object.keys(prevFm),
    ...Object.keys(curFm),
  ]);

  return (
    <div data-testid={`knowledge-window-diff-${windowId}`}>
      <Section title="metadata" testId={`knowledge-fields-${windowId}`}>
        <FieldDiffLine label="path" prev={readString(prev, "path")} cur={readString(cur, "path")} />
        <FieldDiffLine label="source" prev={readString(prev, "source")} cur={readString(cur, "source")} />
        <FieldDiffLine label="presentation" prev={readString(prev, "presentation")} cur={readString(cur, "presentation")} />
        <FieldDiffLine label="status" prev={readString(prev, "status")} cur={readString(cur, "status")} />
      </Section>
      {fmKeys.size > 0 && (
        <Section title="frontmatter" testId={`knowledge-fm-${windowId}`}>
          {Array.from(fmKeys).sort().map((k) => (
            <FieldDiffLine key={k} label={k} prev={prevFm[k]} cur={curFm[k]} />
          ))}
        </Section>
      )}
      <Section title="body" testId={`knowledge-body-${windowId}`}>
        {prevBody === curBody && prevBody === "" ? (
          <div className="muted small">(no body)</div>
        ) : (
          <MarkdownBodyDiff
            previousBody={prevBody}
            currentBody={curBody}
            testId={`knowledge-body-diff-${windowId}`}
          />
        )}
      </Section>
    </div>
  );
}
