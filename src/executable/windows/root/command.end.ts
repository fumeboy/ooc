import type { CommandExecutionContext, CommandKnowledgeEntries, CommandTableEntry } from "../_shared/command-types.js";

/** end command 暴露给 LLM 的知识说明。 */
const KNOWLEDGE = `
end 用于显式结束当前线程，表示当前目标已经完成或不再继续推进。

参数说明：
- reason: 可选，结束原因，例如 done / cancelled / blocked
- summary: 可选，需要沉淀的最终产物或结论

调用示例：
open(type="command", command="end", description="结束当前线程")
refine(form_id, { reason: "done", summary: "commands 的 KNOWLEDGE 已补齐，测试通过" })
submit(form_id)
`;

const END_BASIC_PATH = "internal/executable/end/basic";

/** end command 的可匹配路径集合。 */
export enum EndCommandPath {
  /** 基础 end 指令：标记当前线程完成。 */
  End = "end",
}

/** end command 表项：当前只命中基础 end 路径。 */
export const endCommand: CommandTableEntry = {
  paths: [EndCommandPath.End],
  match: () => {
    return [EndCommandPath.End];
  },
  knowledge: () => {
    const entries: CommandKnowledgeEntries = {
      [END_BASIC_PATH]: KNOWLEDGE.trim(),
    };
    return entries;
  },
  exec: (ctx) => executeEndCommand(ctx),
};

/** 执行 end command：记录结束信息，并把线程状态切为 done。 */
export async function executeEndCommand(ctx: CommandExecutionContext): Promise<string | undefined> {
  if (!ctx.thread) return undefined;

  ctx.thread.endReason = typeof ctx.args.reason === "string" ? ctx.args.reason : undefined;
  ctx.thread.endSummary = typeof ctx.args.summary === "string" ? ctx.args.summary : undefined;
  ctx.thread.status = "done";
  return undefined;
}
