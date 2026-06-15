/**
 * builtin-diff-registry — builtin class 的 window diff 组件静态注册表（线 C）。
 *
 * 对称线 A 的 builtin-visible-registry.tsx。
 * - 有 builtin 目录的从 @ooc/builtins/<type>/visible/diff 导入。
 * - 无 builtin 目录的（talk / do / method_exec）从 web 本地导入。
 */
import type { ComponentType } from "react";
import type { WindowDiffProps } from "./window-diff-props";

// 有 builtin 目录（无 .tsx 扩展名，线 A 约定）:
import FileDiff from "@ooc/builtins/filesystem/file/visible/diff";
import KnowledgeDiff from "@ooc/builtins/knowledge_base/knowledge/visible/diff";
import SearchDiff from "@ooc/builtins/filesystem/search/visible/diff";
import TerminalProcessDiff from "@ooc/builtins/terminal/terminal_process/visible/diff";
import InterpreterProcessDiff from "@ooc/builtins/interpreter/interpreter_process/visible/diff";
import PlanDiff from "@ooc/builtins/agent/plan/visible/diff";
// 无 builtin 目录，web 本地:
import TalkDiff from "./TalkDiff";
import DoDiff from "./DoDiff";
import MethodExecDiff from "./MethodExecDiff";

/** builtin window type → diff 组件。组件约定 `({ previous, current }) => JSX`。 */
export const BUILTIN_DIFF: Record<string, ComponentType<WindowDiffProps>> = {
  file: FileDiff as ComponentType<WindowDiffProps>,
  knowledge: KnowledgeDiff as ComponentType<WindowDiffProps>,
  search: SearchDiff as ComponentType<WindowDiffProps>,
  terminal_process: TerminalProcessDiff as ComponentType<WindowDiffProps>,
  interpreter_process: InterpreterProcessDiff as ComponentType<WindowDiffProps>,
  plan: PlanDiff as ComponentType<WindowDiffProps>,
  talk: TalkDiff as ComponentType<WindowDiffProps>,
  do: DoDiff as ComponentType<WindowDiffProps>,
  method_exec: MethodExecDiff as ComponentType<WindowDiffProps>,
};
