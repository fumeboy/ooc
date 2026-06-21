/**
 * todo —— 可见待办 class 的 **object data** 结构（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗的元信息字段（id/class/parentWindowId/title/createdAt）——那些由 runtime 管理。
 * 没有展示态投影（todo 是静态文本卡片），故 readable 的 win 为 `{}`。
 *
 * - content     : 待办正文（同时作为 title 来源；过长由 runtime 派生元信息 title 时截断）
 * - activatesOn : 可选；命中这些 intent 时强提醒（旧 todo form 的 activates_on）
 * - status      : 业务生命周期态（open=待办 / done=已完成）；非窗的元信息 status，由业务自管
 */
export interface Data {
  content: string;
  activatesOn?: string[];
  status: "open" | "done";
}
