/**
 * knowledge/visible/diff.tsx — knowledge_window 的 visible/diff 组件（线 C）。
 *
 * 逻辑来自 packages/@ooc/web/src/domains/sessions/components/window-diff-renderers/KnowledgeWindowDiff.tsx，
 * 签名收敛到 WindowDiffProps ({previous, current})，删去 windowId 引用。
 *
 * - frontmatter 字段级 JSON diff
 * - body 用 MarkdownBodyDiff（CodeMirror Merge unified）行级 diff
 */

import type { WindowDiffProps } from "@ooc/web/src/domains/sessions/components/window-diff/window-diff-props";
import {
  FieldDiffLine,
  Section,
  asRecord,
  readObject,
  readString,
} from "@ooc/web/src/domains/sessions/components/window-diff-renderers/_shared";
import { MarkdownBodyDiff } from "@ooc/web/src/domains/sessions/components/window-diff-renderers/MarkdownBodyDiff";

export default function KnowledgeWindowDiff({ previous, current }: WindowDiffProps) {
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
    <div data-testid="knowledge-window-diff">
      <Section title="metadata" testId="knowledge-fields">
        <FieldDiffLine label="path" prev={readString(prev, "path")} cur={readString(cur, "path")} />
        <FieldDiffLine label="source" prev={readString(prev, "source")} cur={readString(cur, "source")} />
        <FieldDiffLine label="presentation" prev={readString(prev, "presentation")} cur={readString(cur, "presentation")} />
        <FieldDiffLine label="status" prev={readString(prev, "status")} cur={readString(cur, "status")} />
      </Section>
      {fmKeys.size > 0 && (
        <Section title="frontmatter" testId="knowledge-fm">
          {Array.from(fmKeys).sort().map((k) => (
            <FieldDiffLine key={k} label={k} prev={prevFm[k]} cur={curFm[k]} />
          ))}
        </Section>
      )}
      <Section title="body" testId="knowledge-body">
        {prevBody === curBody && prevBody === "" ? (
          <div className="muted small">(no body)</div>
        ) : (
          <MarkdownBodyDiff
            previousBody={prevBody}
            currentBody={curBody}
            testId="knowledge-body-diff"
          />
        )}
      </Section>
    </div>
  );
}
