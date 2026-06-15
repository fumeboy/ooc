/**
 * todo —— 可见待办 class 的 **object data** 结构（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗信封字段（id/class/parentWindowId/title/createdAt）——那些由 runtime 管理。
 * 没有展示态投影（todo 是静态文本卡片），故 readable 的 win 为 `{}`。
 *
 * - content     : 待办正文（同时作为 title 来源；过长由 runtime 派生信封 title 时截断）
 * - activatesOn : 可选；命中这些 intent 时强提醒（旧 todo form 的 activates_on）
 * - status      : 业务生命周期态（open=待办 / done=已完成）；非窗信封 status，由业务自管
 */
export interface Data {
  content: string;
  activatesOn?: string[];
  status: "open" | "done";
}

/**
 * 过渡兼容别名（deferred）：visible 前端组件本轮**保留不动**，它消费的是
 * 「信封 + Data」的完整窗对象（持 id / title / status / content）。在 core 反推
 * 把 visible 切到 `OocObjectInstance` 之前，此别名让前端 / live union 继续编译；
 * 由 `Data` 派生而非另铺业务字段，避免与 `Data` 漂移。不属业务 Data，勿在后端使用。
 */
export type TodoWindow = Data & {
  id: string;
  class: "todo";
  parentWindowId?: string;
  title: string;
  createdAt: number;
};
