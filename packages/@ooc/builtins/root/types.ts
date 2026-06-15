/**
 * root —— object data 结构（types.ts = 纯 Data）。
 *
 * root 是一切 Object 继承链的终点（BASE 锚点），自身无业务数据字段——每个 thread 隐含一个 root
 * 投影窗（id="root"），其标题即 thread 标题，由 runtime 管理信封。
 */
export interface Data {}
