/**
 * terminal —— 对象**业务数据**结构（types.ts = 纯 Data）。
 *
 * terminal 是 agent 组合持有的 **tool-object 成员**（非 Agent）：它把「跑 bash 脚本」收成方法
 * （run），调它经 `ctx.runtime.instantiate` 造出 terminal_process（bash 子进程 + history）。
 * 它自身**无业务数据**——只承载身份 + 方法面，故 Data 为空对象。
 *
 * 窗信封（id/class/title/status/createdAt）由 runtime 管理；展示态归 readable 的投影态 `win`。
 */
export interface Data {}

/**
 * @deprecated 旧窗类型（信封平铺业务字段）。对象模型迁移后业务数据收进 `Data`、信封由 runtime 管理。
 * 仅为 core 未迁完时（`executable/windows/_shared/types.ts`）的过渡编译兼容保留；core 反推后删除。
 */
export interface TerminalWindow {
  id: string;
  class: "terminal";
  status: "open" | "closed";
}
