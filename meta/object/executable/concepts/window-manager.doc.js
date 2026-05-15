import * as manager from "@src/executable/windows/manager";

/**
 * WindowManager 概念：替代旧 FormManager 的统一 ContextWindow 操作入口。
 *
 * sources:
 *  - manager — WindowManager 类、openCommandExec、refine、submit、close 等
 */
export const window_manager_v20260515_1 = {
  name: "WindowManager",
  description: `
WindowManager 持有 thread.contextWindows，封装所有 window 的增删改查。
对外暴露与 LLM 5 原语一一对应的方法：

- openCommandExec — 在 parent window 下创建 command_exec sub-window；当 args 完整且不引入
  新协议知识时，会立刻提交 form（具体行为由各 command 自己控制）
- openTypedWindow — 创建非 form 的 window（do_window / todo_window 等）
- refine — 累积 command_exec 的 args 并重算 commandPaths
- submit — 执行 command；成功自动移除 form；失败保留 result
- close — 触发 type 的 onClose hook，级联关闭子 window

WindowManager 不负责：command 自身的 exec 实现（在各 windows/*.ts）、knowledge entries
的具体内容（在 collectExecutableKnowledgeEntries）、持久化（在 src/persistable/thread-json.ts）。

使用模式：
  const mgr = WindowManager.fromThread(thread);
  const formId = await mgr.openCommandExec(...);
  thread.contextWindows = mgr.toData();
`.trim(),
  sources: { manager },
};
