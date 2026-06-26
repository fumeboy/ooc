/**
 * agent —— object data 结构（types.ts = 纯 Data）。
 *
 * agent 是 OOC Agent 基类,承载 agency（executable 维度）+ **身份**（self.md）。
 * `self` 是 agent 实例的身份正文（self.md 内容）：经 agent 的 persistable 写入/读回实例
 * 目录的 self.md、渲为 **self 门面窗的 self 视角内容**（`resolveProjection`→`readSelf`，非 thinkloop
 * instructions）——self.md 只属 ooc agent 实例（见对象模型核心 9）。具体 agent（supervisor 等）经
 * ooc.class 继承本类。
 */
export interface Data {
  self: string;
}

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * `self` 是 agent 的身份，每次迭代须测试评估（reflectable feat-branch PR）；其余字段（如有）
 * 默认非版本化。`index.ts` 装配时引用本常量赋给 `Class.versioned_fields`。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = ["self"] as const;
