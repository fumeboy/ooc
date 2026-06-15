/**
 * runtime —— 对象 **业务数据**结构（types.ts = 纯 Data）。
 *
 * runtime 是 agent 组合持有的 **tool-object 成员**（非 Agent）：它向 Agent 提供**系统级接口**——
 * create_object（把新对象骨架落 session worktree）。
 * 区别于 filesystem（字节级文件）：runtime 操作的是「对象世界」语义（建对象 / 类链 / 沉淀）。
 *
 * runtime 是**单例工具对象**，无业务态——窗信封字段（id/class/status）由 runtime 管理，不在此。
 */
export interface Data {}
