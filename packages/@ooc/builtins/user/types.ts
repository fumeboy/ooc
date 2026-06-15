/**
 * user —— 真人用户在 OOC World 内的占位 **object 实例**（不是 LLM Agent）。
 *
 * user 是单例 object（kind=object，无 class）：没有业务字段，纯占位。Data 为空。
 * 身份信封（id/class/title/status/createdAt）由 runtime 管理。
 */
export interface Data {}
