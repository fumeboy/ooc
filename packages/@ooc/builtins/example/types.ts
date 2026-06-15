/**
 * example —— 对象模型最小样板 class 的 **object data** 结构（types.ts = 纯 Data）。
 *
 * 只含业务字段；**不含**窗信封字段（id/class/title/status/createdAt）——那些由 runtime 管理。
 * 展示态（viewport）也不在此，归 readable 的投影态 `win`（见 readable/index.ts 的 `ExampleWin`）。
 *
 * - message  : 要展示的文本（可多行）
 * - bumpCount: 被 `bump` object method 累加的次数
 */
export interface Data {
  message: string;
  bumpCount: number;
}
