/**
 * agent —— object data 结构（types.ts = 纯 Data）。
 *
 * agent 是 OOC Agent 基类，承载 agency（executable 维度）+ **身份**（self.md）。
 * `self` 是 agent 实例的身份正文（self.md 内容）：经 agent 的 persistable 写入/读回实例
 * 目录的 self.md、渲为 **self 门面窗的 self 视角内容**（`resolveProjection`→`readSelf`，非 thinkloop
 * instructions）——self.md 只属 ooc agent 实例（见对象模型核心 9）。具体 agent（supervisor 等）经
 * ooc.class 继承本类。
 *
 * `superThreadRef`（optional / **非版本化**）：caller agent 经 `talk(target="super")` 触发后
 * 持有的「自己在 super flow 内对端 thread」单向引用（issue D 落地裁决 2 跨 session 自指）。
 * 多次 talk(super) 复用同一 super thread（caller 持 ref 即重用）；消息派送由 caller 直接
 * 写入 super flow 内该 thread 的 inbox.json——避免引入 cross-session bus 基础设施。
 *
 * TODO(issue-C-VERSIONED_FIELDS)：issue C verified 后须在 class.versioned_fields 显式声明
 * superThreadRef 不在 VERSIONED 集（PR 流程不应分发它，否则把运行时 ref 当身份提案）。
 */
export interface Data {
  self: string;
  /**
   * 跨 session 自指引用（caller 在 super flow 内的对端 thread）。
   *
   * 幂等键 = `(callerSessionId, callerObjectId)`：同一对象同 session 多次 talk(super)
   * 复用同一 super thread；消息派送由 `method.talk` 直接写 super flow 内 callee thread
   * 的 inbox.json，不走 cross-session bus。
   */
  superThreadRef?: {
    threadId: string;
    sessionId: string;
  };
}
