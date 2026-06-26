/**
 * agent —— object data 结构（types.ts = 纯 Data）。
 *
 * agent 是 OOC Agent 基类,承载 agency（executable 维度）+ **身份**（self.md）。
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
 * **版本化字段**：仅 `self`（由 `VERSIONED_FIELDS` 常量声明、`index.ts` 装配时赋给
 * `Class.versioned_fields`）。`superThreadRef` 是运行时跨 session 引用，非身份提案，不在
 * VERSIONED 集（避免 PR 流程把运行时 ref 当身份分发）。
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

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * `self` 是 agent 的身份，每次迭代须测试评估（reflectable feat-branch PR）；其余字段（如有）
 * 默认非版本化。`index.ts` 装配时引用本常量赋给 `Class.versioned_fields`。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = ["self"] as const;
