/**
 * user —— 真人用户在 OOC World 内的占位 **object class**（不是 LLM Agent，不跑 thinkloop）。
 *
 * 经 `_builtin/user` class 继承，可有多个实例（按 name 区分）；scheduler 跳过 user 实例。
 * agent.talk(target="user") 向 user 推 messages；控制面把人类回复写入对应 thread。
 */
export interface Data {
  /** display name / 标识。 */
  name?: string;
}

/**
 * 版本化字段列表（issue C 同伴常量方案 B）。
 *
 * 本 class 全部字段非版本化（运行时载体 / tool-object / sediment 已落 pool）。
 */
export const VERSIONED_FIELDS: readonly (keyof Data)[] = [] as const;
