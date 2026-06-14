/**
 * interpreter_process 的 visible/diff 组件 —— 复用 _shared 的 ProcessWindowDiff。
 */
import type { WindowDiffProps } from "@ooc/web/src/domains/sessions/components/window-diff/window-diff-props";
import { ProcessWindowDiff } from "@ooc/builtins/_shared/visible/process-diff";

export default function InterpreterProcessWindowDiff(props: WindowDiffProps) {
  return ProcessWindowDiff(props, {
    testId: "interpreter-process-window-diff",
    fieldsTitle: "interpreter_process fields",
    fieldsTestId: "interpreter-process-fields",
    historyTestId: "interpreter-process-history",
  });
}
