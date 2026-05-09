import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

export const KNOWLEDGE = `
plan 用于把一个目标拆成可执行步骤，并输出后续行动计划。

参数说明：
- goal: 必填，本次要规划的目标
- context: 可选，补充当前约束、背景或已有信息
- deliverable: 可选，希望产出的结果形式，例如 checklist / milestone / draft
- horizon: 可选，计划范围，例如 current_task / short_term / long_term

调用示例：
open(type="command", command="plan", description="先把迁移工作拆解")
refine(form_id, { goal: "完成 executable command 迁移", context: "先补齐 command skeleton 与测试", deliverable: "checklist" })
submit(form_id)
`;

export enum PlanCommandPath {
  /** 基础 plan 指令：制定计划。 */
  Plan = "plan",
}

export const planCommand: CommandTableEntry = {
  paths: [
    PlanCommandPath.Plan,
  ],
  match: (_args) => {
    return [PlanCommandPath.Plan];
  },
  // 暂不实现具体执行逻辑
};

/** 执行 plan 命令（占位实现，暂未实现具体逻辑） */
export async function executePlanCommand(_ctx: CommandExecutionContext): Promise<void> {
  // 暂未实现具体逻辑
}
