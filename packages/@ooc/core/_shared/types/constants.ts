/**
 * Super flow 约定常量 —— canonical 源（batch C2 从
 * `executable/windows/_shared/super-constants.ts` 迁入）。
 *
 * 任何需要 "super" 字面量的代码都从 `@ooc/core/_shared` 取；旧路径
 * (executable/extendable 下的 super-constants.ts) 现为 re-export 壳。
 *
 * 详见 meta/object/reflectable concept。
 */

/** super flow 受保护 sessionId。 */
export const SUPER_SESSION_ID = "super";

/** talk_window.target 的自指别名值；解析为 caller 自己的 super 分身。 */
export const SUPER_ALIAS_TARGET = SUPER_SESSION_ID;

/** 大小写无关校验 'super'；防 HFS+ 等大小写不敏感文件系统绕过。 */
export function isSuperSessionId(sessionId: string): boolean {
  return sessionId.trim().toLowerCase() === SUPER_SESSION_ID;
}
