import * as manager from "@src/executable/windows/manager";

/**
 * command_exec form 生命周期概念：open → executing → executed → 自动移除/保留待 close。
 *
 * sources:
 *  - manager — openCommandExec / submit 实现 form 状态机
 */
export const command_exec_lifecycle_v20260515_1 = {
  name: "CommandExecLifecycle",
  description: `
command_exec form 是 LLM 调用某个 command 时产生的临时 sub-window。其生命周期：

- open：刚创建，可继续 refine 或 submit
  - 当 args 完整且不引入新协议知识时，open 立即提交 form 而无需再额外 submit；
    这由各个具体 command 的实现自行控制
- executing：submit 已执行命令体，正在运行
- executed：已执行
  - 成功 → 系统自动从 contextWindows 移除（form 不需要 close）
  - 失败 → 保留 status=executed + result，等 LLM 显式 close 清理

实现要点（见 WindowManager.openCommandExec）：
- 接收 args 时立刻 apply 一次 refine（累积到 form 上）
- 计算 baseline vs next 的 commandPaths / knowledge keys；当 next ⊇ baseline 且
  不引入新 knowledge key 时即触发 auto-submit
- submit 内部 mutate thread.contextWindows；调用方负责把 mgr.toData() 写回 thread
`.trim(),
  sources: { manager },
};
