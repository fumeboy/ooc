import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const KNOWLEDGE = `
do 用于在当前对象内部派生子线程，或向已有子线程继续追加消息。

参数说明：
- context: 必填，fork 或 continue
- msg: 必填，要写入目标线程 inbox 的消息
- threadId: 可选；continue 时通常必填，fork 时可指定父线程
- knowledge: 可选，仅 fork 时给子线程额外引入的 knowledge path 列表
- wait: 可选，fork 后是否等待子线程完成

调用示例：
open(type="command", command="do", description="派生子线程处理子任务")
refine(form_id, { context: "fork", msg: "请检查日志", wait: true, knowledge: ["kernel:debug"] })
submit(form_id)
`;

export enum DoCommandPath {
  /** 基础 do 指令：执行动作。 */
  Do = "do",
  /** fork 模式：在新线程中执行动作。 */
  Fork = "do.fork",
  /** continue 模式：向已有线程追加消息。 */
  Continue = "do.continue",
  /** wait 模式：等待子线程完成。 */
  Wait = "do.wait",
}

export const doCommand: CommandTableEntry = {
  paths: [
    DoCommandPath.Do,
    DoCommandPath.Fork,
    DoCommandPath.Continue,
    DoCommandPath.Wait,
  ],
  match: (args) => {
    const hit: string[] = [DoCommandPath.Do];
    const ctx = typeof args.context === "string" ? args.context : "";
    if (ctx === "fork") hit.push(DoCommandPath.Fork);
    if (ctx === "continue") hit.push(DoCommandPath.Continue);
    if (args.wait === true) hit.push(DoCommandPath.Wait);
    return hit;
  },
  // 暂不实现具体执行逻辑
};

/** 执行 do 命令（占位实现，暂未实现具体逻辑） */
export async function executeDoCommand(_ctx: CommandExecutionContext): Promise<void> {
  // 暂未实现具体逻辑
}
