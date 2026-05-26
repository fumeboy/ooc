import type { BaseContextWindow } from "../_shared/types.js";

/**
 * Plan window — 行动计划窗口（first-class ContextWindow）。
 *
 * 2026-05-26 升级（B 段 design / docs/2026-05-26-remove-issue-add-subplan-design.md §3）:
 * - 以前是 thread.plan 字符串字段；现在升格为 ContextWindow
 * - 支持 sub plan 嵌套（expand_step 自动创建 child plan_window）
 * - 复用 do_window.move sharing 协议跨 thread 共享（不发明新机制）
 *
 * 数据形态:
 * - title / description: plan 主题与说明
 * - steps: 可执行步骤列表（顺序排列；id plan 树内唯一）
 * - parentPlanWindowId / parentStepId: 父 plan / 父 step 反向链（root plan 无）
 * - status: active / done / archived（与 BaseContextWindow.status 复用，含义见下）
 *
 * 注册的 commands (windows/plan/index.ts):
 * - update_plan / add_step / update_step / expand_step / collapse_subplan / mark_done / close
 *
 * renderXml: <plan_window>...</plan_window> 含 title / description / steps
 * compressView: level 1 = title+status+step count+done/total；level 2 = title+status
 */
export interface PlanWindowStep {
  /** plan 树内稳定唯一 id（建议生成时使用 step-<n>_<rand> 形态）。 */
  id: string;
  /** 步骤描述文本。 */
  text: string;
  /** 步骤状态。 */
  status: "pending" | "in-progress" | "done" | "blocked";
  /** 若本 step 被 expand_step 展开为 sub plan，指向 child plan_window.id。 */
  subPlanWindowId?: string;
}

export interface PlanWindow extends BaseContextWindow {
  type: "plan";
  /** plan_window status: active=进行中；done=已完成；archived=已归档（cascade close 子时也会被切到 archived）。 */
  status: "active" | "done" | "archived";
  /** plan 主题（已在 BaseContextWindow.title 体现；plan_window 内仅复用 base.title）。 */
  /** plan 说明（可选；多用于描述目标与约束）。 */
  description?: string;
  /** 步骤列表；保持创建顺序。 */
  steps: PlanWindowStep[];
  /** 父 plan_window.id；root plan 不存在此字段。 */
  parentPlanWindowId?: string;
  /** 父 plan 中将本 plan 作为 sub 的那一 step id；与 parentPlanWindowId 配对。 */
  parentStepId?: string;
}
