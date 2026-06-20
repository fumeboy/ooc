/**
 * agent —— object data 结构（types.ts = 纯 Data）。
 *
 * agent 是 OOC Agent 基类，承载 agency（executable 维度）+ **身份**（self.md）。
 * `self` 是 agent 实例的身份正文（self.md 内容）：经 agent 的 persistable 写入/读回实例
 * 目录的 self.md、渲为 **self 门面窗的 self 视角内容**（`resolveProjection`→`readSelf`，非 thinkloop
 * instructions）——self.md 只属 ooc agent 实例（见对象模型核心 9）。具体 agent（supervisor 等）经
 * ooc.class 继承本类。
 */
export interface Data {
  self: string;
}
