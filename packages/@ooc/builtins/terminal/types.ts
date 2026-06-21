/**
 * terminal —— 对象**业务数据**结构（types.ts = 纯 Data）。
 *
 * terminal 是 agent 组合持有的 **tool-object 成员**（非 Agent）：它把「跑 bash 脚本」收成方法
 * （run），调它经 `ctx.runtime.instantiate` 造出 terminal_process（bash 子进程 + history）。
 * 它自身**无业务数据**——只承载身份 + 方法面，故 Data 为空对象。
 *
 * 窗的元信息（id/class/title/status/createdAt）由 runtime 管理；展示态归 readable 的投影态 `win`。
 */
export interface Data {}
