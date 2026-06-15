/**
 * plan —— 行动计划对象的 **object data** 结构（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗信封字段（id/class/parentWindowId/createdAt 等）——那些由 runtime 管理。
 * 也无展示态——plan 当前无投影态视口（readable 直接投影整棵 step 树）。
 *
 * 数据形态：
 * - title / description : plan 主题与说明（业务字段；update_plan 可改）
 * - steps              : 可执行步骤列表（顺序排列；id 在 plan 树内唯一）
 * - parentPlanWindowId / parentStepId : 父 plan / 父 step 反向软链（root plan 无）
 * - status             : 业务状态 active=进行中 / done=已完成 / archived=已归档
 *   （cascade collapse / close 子时也会被切到 archived）
 */
export interface PlanWindowStep {
  /** plan 树内稳定唯一 id（生成形态 `step_<n>_<rand>`）。 */
  id: string;
  /** 步骤描述文本。 */
  text: string;
  /** 步骤状态。 */
  status: "pending" | "in-progress" | "done" | "blocked";
  /** 若本 step 被 expand_step 展开为 sub plan，指向 child plan 对象 id。 */
  subPlanWindowId?: string;
}

export interface Data {
  /** plan 主题（业务字段；update_plan 可改）。 */
  title: string;
  /** plan 说明（可选；多用于描述目标与约束）。 */
  description?: string;
  /** 步骤列表；保持创建顺序。 */
  steps: PlanWindowStep[];
  /** 业务状态：active=进行中；done=已完成；archived=已归档。 */
  status: "active" | "done" | "archived";
  /** 父 plan 对象 id；root plan 不存在此字段。 */
  parentPlanWindowId?: string;
  /** 父 plan 中将本 plan 作为 sub 的那一 step id；与 parentPlanWindowId 配对。 */
  parentStepId?: string;
}

/**
 * 过渡兼容别名（deferred / Wave3）：visible 前端组件本轮**保留不动**，它消费的是
 * 「信封 + Data」的完整窗对象（持 id / title / parentPlanWindowId / steps）。在 core 反推
 * 把 visible 切到 `OocObjectInstance` 之前，此别名让前端继续编译；不属业务 Data，勿在后端使用。
 */
export type PlanWindow = Data & {
  id: string;
  class: "plan";
  parentWindowId?: string;
  createdAt?: number;
};
