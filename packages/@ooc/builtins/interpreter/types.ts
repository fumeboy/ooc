/**
 * interpreter —— 对象**业务数据**结构（types.ts = 纯 Data）。
 *
 * interpreter 是 agent 组合持有的 **tool-object 成员**（非 Agent）：它把「跑 ts/js 脚本」收成
 * 方法（run），调它经 `ctx.runtime.instantiate` 造出 interpreter_process（ts/js sandbox + history）。
 * 它自身**无业务数据**——只承载身份 + 方法面，故 Data 为空对象。
 *
 * 窗的元信息（id/class/title/status/createdAt）由 runtime 管理；展示态归 readable 的投影态 `win`。
 */
export interface Data {}

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * 本 class 全部字段非版本化（运行时载体 / tool-object / sediment 已落 pool）。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = [] as const;
