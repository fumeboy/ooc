/**
 * terminal_process 的 visible/diff 组件 —— 复用 _shared 的 ProcessWindowDiff。
 */
import type { WindowDiffProps } from "@ooc/web/src/domains/sessions/components/window-diff/window-diff-props";
import { ProcessWindowDiff } from "@ooc/builtins/_shared/visible/process-diff";

export default function TerminalProcessWindowDiff(props: WindowDiffProps) {
  return ProcessWindowDiff(props, {
    testId: "terminal-process-window-diff",
    fieldsTitle: "terminal_process fields",
    fieldsTestId: "terminal-process-fields",
    historyTestId: "terminal-process-history",
  });
}
