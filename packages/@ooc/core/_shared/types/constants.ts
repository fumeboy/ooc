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
export const THREAD_CLASS_ID = "_builtin/agent/thread";

/**
 * knowledge 子对象的注册 class id（knowledge_base 经 open_knowledge 实例化的 doc 窗）。
 * 合成的协议/召回 knowledge 窗（protocol.ts / activator-windows.ts）与真实 open_knowledge 窗
 * 都用它当 inst.class，使 resolveReadable 能命中 knowledge readable（投影回 window class "knowledge"）；
 * 直接写投影名 "knowledge" 会 resolve 不到 readable → 渲染成 placeholder。
 */
export const KNOWLEDGE_CLASS_ID = "_builtin/knowledge_base/knowledge";

/** 该 window 是不是 knowledge 实例（合成或真实 open_knowledge 窗，inst.class === KNOWLEDGE_CLASS_ID）。 */
export function isKnowledgeClass(cls: string | undefined): boolean {
  return cls === KNOWLEDGE_CLASS_ID;
}

/** file 对象的注册 class id（filesystem.open_file / search.open_match 实例化）。投影名才是 "file"。 */
export const FILE_CLASS_ID = "_builtin/filesystem/file";

/** 该 window 是不是 file 实例（inst.class === FILE_CLASS_ID；裸名 "file" 是 readable 投影 class）。 */
export function isFileClass(cls: string | undefined): boolean {
  return cls === FILE_CLASS_ID;
}

/** pr 评审窗的注册 class id（reviewer 收到的待审 PR 窗）。投影名才是 "pr"。 */
export const PR_CLASS_ID = "_builtin/agent/pr";

/**
 * "会话型" window 谓词 —— 判一条 context window 是不是会话载体（thread）实例。
 *
 * thread 是**唯一**会话载体注册 class：所有会话窗（creator/peer/sub/fork）的 inst.class 都是
 * `_builtin/thread`。talk / reflect_request 不是注册 class，而是 thread readable 按视角（POV）
 * 投影出的 **window class**（self-view 非 super→thread、other-view→talk、self-view super→
 * reflect_request），投影值只在渲染期算、不写进 inst.class（context.md 核心 2/8/9）。
 *
 * 故凡按"会话窗"语义处理 inst 的逻辑（回信归位、peer 派生、wait、inbox 归窗），一律按
 * inst.class === `_builtin/thread` 识别会话窗，再据 inst.data 的 isForkWindow 区分 fork/peer、
 * 据 id（`isCreatorWindowId`）派生 creator 窗（不存 data.isCreatorWindow flag）——不再按投影值识别。
 */
export function isTalkLikeClass(cls: string | undefined): boolean {
  return cls === THREAD_CLASS_ID;
}
