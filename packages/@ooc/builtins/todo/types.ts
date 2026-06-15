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
 * @deprecated 过渡兼容别名 —— 旧 `TodoWindow`（窗信封 + 业务字段平铺）的形状，
 * 仅为让尚未迁移的 visible 组件 / 外部引用在 core 反推完成前继续编译。
 * core 反推到新契约后删除。新代码一律用 `Data`。
 */
export interface TodoWindow {
  id: string;
  class: "todo";
  parentWindowId?: string;
  title: string;
  status: "open" | "done";
  createdAt: number;
  content: string;
  activatesOn?: string[];
}
