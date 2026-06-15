/**
 * Super flow 约定常量 —— canonical 源。
 *
 * 任何需要 "super" 字面量的代码都从 `@ooc/core/_shared` 取。
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

/** 唯一会话载体注册 class。所有会话窗（creator/peer/sub/fork）inst.class 一律是它。 */
export const THREAD_CLASS_ID = "_builtin/thread";

/**
 * "会话型" window 谓词 —— 判一条 context window 是不是会话载体（thread）实例。
 *
 * thread 是**唯一**会话载体注册 class：所有会话窗（creator/peer/sub/fork）的 inst.class 都是
 * `_builtin/thread`。talk / reflect_request 不是注册 class，而是 thread readable 按视角（POV）
 * 投影出的 **window class**（self-view 非 super→thread、other-view→talk、self-view super→
 * reflect_request），投影值只在渲染期算、不写进 inst.class（context.md 核心 2/8/9）。
 *
 * 故凡按"会话窗"语义处理 inst 的逻辑（回信归位、peer 派生、wait、inbox 归窗），一律按
 * inst.class === `_builtin/thread` 识别会话窗，再据 inst.data 的 isForkWindow/isCreatorWindow
 * 区分形态——不再按投影值识别。
 */
export function isTalkLikeClass(cls: string | undefined): boolean {
  return cls === THREAD_CLASS_ID;
}
