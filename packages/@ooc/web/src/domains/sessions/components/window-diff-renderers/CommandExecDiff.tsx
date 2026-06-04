/**
 * MethodExecDiff — method_exec window 的 args 字段级 diff（design § 4.8）。
 *
 * Phase H rename: 原 CommandExecDiff,对应 type 字符串 "command_exec" → "method_exec"。
 *
 * method_exec 的 args 在 refine 阶段会累积；逐 loop 增量。
 * - command / status 字段顶部
 * - accumulatedArgs 按 key 逐项 diff（added / removed / changed / unchanged）
 * - result 字段（string）单独显示
 */

import type { WindowDiffRendererProps } from "./registry";
import {
  FieldDiffLine,
  Section,
  asRecord,
  readObject,
  readString,
} from "./_shared";

export function MethodExecDiff(props: WindowDiffRendererProps) {
  const { previous, current, windowId } = props;
  const prev = asRecord(previous);
  const cur = asRecord(current);

  const prevArgs = readObject(prev, "accumulatedArgs") ?? {};
  const curArgs = readObject(cur, "accumulatedArgs") ?? {};
  const argKeys = Array.from(
    new Set([...Object.keys(prevArgs), ...Object.keys(curArgs)]),
  ).sort();

  return (
    <div data-testid={`command-exec-diff-${windowId}`}>
      <Section title="command" testId={`commandexec-fields-${windowId}`}>
        <FieldDiffLine label="command" prev={readString(prev, "command")} cur={readString(cur, "command")} />
        <FieldDiffLine label="status" prev={readString(prev, "status")} cur={readString(cur, "status")} />
        <FieldDiffLine
          label="description"
          prev={readString(prev, "description")}
          cur={readString(cur, "description")}
        />
      </Section>
      <Section
        title={`accumulatedArgs (${argKeys.length} key${argKeys.length === 1 ? "" : "s"})`}
        testId={`commandexec-args-${windowId}`}
      >
        {argKeys.length === 0 ? (
          <div className="muted small">(no args)</div>
        ) : (
          argKeys.map((k) => (
            <FieldDiffLine key={k} label={k} prev={prevArgs[k]} cur={curArgs[k]} />
          ))
        )}
      </Section>
      <Section title="result" testId={`commandexec-result-${windowId}`}>
        <FieldDiffLine label="result" prev={readString(prev, "result")} cur={readString(cur, "result")} />
      </Section>
    </div>
  );
}

/** @deprecated Phase H: renamed to MethodExecDiff. */
export const CommandExecDiff = MethodExecDiff;
