/**
 * agent —— object data 结构（types.ts = 纯 Data）。
 *
 * agent 是 OOC Agent 基类，只承载 agency（executable 维度）；自身**无业务数据字段**。
 * 具体 agent（supervisor 等）经 ooc.class 继承本类，各自的业务数据在各自 types.ts 定义。
 */
export interface Data {}
