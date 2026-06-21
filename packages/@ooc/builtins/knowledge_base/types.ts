/**
 * knowledge_base —— object **业务数据**结构（types.ts = 纯 Data）。
 *
 * knowledge_base 是 agent 组合持有的 **tool-object 成员**（非 Agent）：可查询的知识存储。
 * `open_knowledge` 把一篇 knowledge doc 作为 `knowledge` 窗引入 context（doc 是窗，store 是成员——
 * 故成员类型名 knowledge_base，区别于 `knowledge` 窗口类型）。
 *
 * 它无业务字段：是单例、纯委托的 tool-object（数据来自 self.md / 缺省空）。
 * 窗的元信息字段（id/class/title/status/createdAt）由 runtime 管理；展示态归 readable 的投影态 `win`。
 */
export interface Data {}
