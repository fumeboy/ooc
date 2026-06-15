/**
 * supervisor —— object data 结构（types.ts = 纯 Data）。
 *
 * supervisor 是 **kind=object**（World 中枢的唯一实例，不是 class）：继承 `_builtin/agent`
 * 拿到 agency（talk/plan/todo/end），自身**无额外业务字段**。身份/对外介绍走 self.md /
 * readable.md（静态文件，由 core readable 解析）；`status: "active"` 是对象信封态，
 * 由 runtime 管理、不在 Data 内。
 */
export interface Data {}
