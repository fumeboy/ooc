/**
 * filesystem —— 对象 **业务数据**（types.ts = 纯 Data）。
 *
 * filesystem 是一个 **tool-object**（被 agent 组合持有的成员对象，非 Agent）：
 * 它把"对文件世界的操作"收成一组连贯方法（grep/glob/open_file/write_file），
 * 这些方法委托 runtime 造出 search / file 对象。对象本身**无业务数据**——只承载身份 + 方法面。
 *
 * 因此 Data 为空对象。窗的元信息（id/class/title/status/createdAt）由 runtime 管理、不在此。
 */
export interface Data {}

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * 本 class 全部字段非版本化（运行时载体 / tool-object / sediment 已落 pool）。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = [] as const;
