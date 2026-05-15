import * as types from "@src/executable/windows/types";
import * as windows from "@src/executable/windows/index";

/**
 * ContextWindow 概念：thread 持有的上下文单元。
 *
 * sources:
 *  - types  — ContextWindow union 与各 type 的字段定义
 *  - windows — WindowManager 入口与 type registry 装载点
 */
export const context_window_v20260515_1 = {
  name: "ContextWindow",
  description: `
ContextWindow 是 thread 持有的上下文单元。每个 thread 持有一组 contextWindows
（root / command_exec / do / todo / talk / program / file / knowledge）。

每个 window 都有 id / type / title / status，并按各自 type 注册一组可被 LLM 调用的 command。
LLM 通过 5 原语 \`open / refine / submit / close / wait\` 与 window 交互。

- root window 注册 do/talk/program/plan/end/todo 等顶层 command
- command_exec window 是调用某 command 时产生的 sub-window（旧 form 概念新身份）
- do_window / todo_window / talk_window / program_window / file_window / knowledge_window
  都是 submit 副作用产出的持久 window
`.trim(),
  sources: { types, windows },
};
