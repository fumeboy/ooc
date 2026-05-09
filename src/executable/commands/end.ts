import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const KNOWLEDGE = `
end 用于显式结束当前线程，表示当前目标已经完成或不再继续推进。

参数说明：
- result: 可选，本轮工作的结果摘要
- reason: 可选，结束原因，例如 done / cancelled / blocked
- summary: 可选，需要沉淀的最终产物或结论

调用示例：
open(type="command", command="end", description="结束当前线程")
refine(form_id, { reason: "done", result: "commands 的 KNOWLEDGE 已补齐，测试通过" })
submit(form_id)
`;

export enum EndCommandPath {
  /** 基础 end 指令：标记当前线程完成。 */
  End = "end",
}

export const endCommand: CommandTableEntry = {
  paths: [EndCommandPath.End],
  match: () => {
    return [EndCommandPath.End];
  },
  // 暂不实现具体执行逻辑
};

/** 执行 end 命令（占位实现，暂未实现具体逻辑） */
export async function executeEndCommand(_ctx: CommandExecutionContext): Promise<void> {
  // 暂未实现具体逻辑
}
