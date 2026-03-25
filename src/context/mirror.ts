/**
 * Mirror — 行为观察器
 *
 * 分析 Flow 的行为历史，生成行为摘要注入 Context。
 * 对象通过观察自己的行为模式来触发自我改进。
 *
 * 设计哲学：Mirror 不是命令（"你该反思了"），而是镜子（"看看你在做什么"）。
 * LLM 看到事实后会自己做出判断。
 *
 * @ref .ooc/docs/哲学文档/gene.md#G12 — implements — 经验沉淀的觉察前提
 * @ref .ooc/docs/哲学文档/gene.md#G5 — references — 注入 Context 的行为观察窗口
 */

import type { FlowData, Action } from "../types/index.js";
import type { StoneData } from "../types/index.js";
import { collectAllActions } from "../process/tree.js";

/**
 * 构建行为观察摘要
 *
 * @param flow - 当前 Flow 数据
 * @param stone - 当前 Stone 数据
 * @returns 行为观察文本，如果没有值得观察的内容则返回 null
 */
export function buildMirror(flow: FlowData, stone: StoneData): string | null {
  const actions = collectAllActions(flow.process.root);
  if (actions.length < 2) return null; // 刚开始，没什么可观察的

  const lines: string[] = [];

  /* === 基础统计 === */
  const thoughts = actions.filter(a => a.type === "thought").length;
  const programs = actions.filter(a => a.type === "program").length;
  const successPrograms = actions.filter(a => a.type === "program" && a.success === true).length;
  const failedPrograms = actions.filter(a => a.type === "program" && a.success === false).length;

  lines.push(`本次任务已执行 ${actions.length} 步（${thoughts} 思考 + ${programs} 程序）`);
  if (failedPrograms > 0) {
    lines.push(`程序执行：${successPrograms} 成功 / ${failedPrograms} 失败`);
  }

  /* === API 使用观察 === */
  const allContent = actions.map(a => a.content + (a.result || "")).join("\n");

  const usedSetData = allContent.includes("setData(") || allContent.includes("setData(");
  const usedPersistData = allContent.includes("persistData(");
  const usedCreateTrait = allContent.includes("createTrait(");
  const usedWriteShared = allContent.includes("writeShared(");
  const usedCreatePlan = allContent.includes("createPlan(");
  const usedCompleteStep = allContent.includes("completeStep(");

  /* === 数据存储观察 === */
  if (usedSetData && !usedPersistData) {
    lines.push("你使用了 setData（任务记忆），但尚未使用 persistData（长期记忆）");
  }

  /* === 验证观察 === */
  // 检查最近的 program 是否有验证行为（print 输出检查结果）
  const recentPrograms = actions.filter(a => a.type === "program").slice(-3);
  const hasVerification = recentPrograms.some(a =>
    a.content.includes("print(") && (
      a.content.includes("getData(") ||
      a.content.includes("readShared(") ||
      a.content.includes("验证") ||
      a.content.includes("检查")
    )
  );
  if (programs >= 3 && !hasVerification) {
    lines.push("尚未运行验证代码确认产出正确性");
  }

  /* === 行为树观察 === */
  if (usedCreatePlan && !usedCompleteStep && programs >= 4) {
    lines.push("创建了行为树但尚未 completeStep 任何步骤");
  }

  /* === 经验沉淀观察 === */
  // 检查 stone 中的历史任务数量
  const completedTasks = Object.keys(stone.data).filter(k => k.startsWith("_task_")).length;
  if (completedTasks >= 2 && !usedCreateTrait) {
    lines.push(`你已完成多个任务，但尚未沉淀工作模式为 trait`);
  }

  /* === 连续失败观察 === */
  const lastActions = actions.slice(-4);
  const consecutiveFailures = lastActions.filter(a => a.type === "program" && a.success === false).length;
  if (consecutiveFailures >= 2) {
    lines.push(`最近连续 ${consecutiveFailures} 次程序执行失败，考虑换一种方法`);
  }

  // 如果没有值得观察的内容，不注入
  if (lines.length <= 1) return null;

  return "## 行为观察\n" + lines.map(l => `- ${l}`).join("\n");
}
