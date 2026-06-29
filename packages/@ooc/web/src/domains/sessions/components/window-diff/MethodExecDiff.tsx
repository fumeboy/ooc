/**
 * MethodExecDiff — method_exec window 的 visible/diff 组件（线 C）。
 *
 * 逻辑来自 window-diff-renderers/CommandExecDiff.tsx（MethodExecDiff 部分），
 * 签名收敛到 WindowDiffProps ({previous, current})，删去 windowId 引用。
 *
 * Diff 形态：
 *   - command / status / description 字段顶部
 *   - accumulatedArgs 按 key 逐项 diff（added / removed / changed / unchanged）
 *   - result 字段（string）单独显示
 */

import type { WindowDiffProps } from "./window-diff-props";
import {
  FieldDiffLine,
  Section,
  asRecord,
  readObject,
  readString,
} from "../window-diff-renderers/_shared";

export default function MethodExecDiff({ previous, current }: WindowDiffProps) {
  const prev = asRecord(previous);
  const cur = asRecord(current);

  const prevArgs = readObject(prev, "accumulatedArgs") ?? {};
  const curArgs = readObject(cur, "accumulatedArgs") ?? {};
  const argKeys = Array.from(
    new Set([...Object.keys(prevArgs), ...Object.keys(curArgs)]),
  ).sort();

  return (
    <div data-testid="method-exec-diff">
      <Section title="command" testId="methodexec-fields">
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
        testId="methodexec-args"
      >
        {argKeys.length === 0 ? (
          <div className="muted small">(no args)</div>
        ) : (
          argKeys.map((k) => (
            <FieldDiffLine key={k} label={k} prev={prevArgs[k]} cur={curArgs[k]} />
          ))
        )}
      </Section>
      <Section title="result" testId="methodexec-result">
        <FieldDiffLine label="result" prev={readString(prev, "result")} cur={readString(cur, "result")} />
      </Section>
    </div>
  );
}
