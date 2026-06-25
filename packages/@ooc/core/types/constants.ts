/**
 * 系统常量 + 类 id 谓词 —— 纯字面量、零依赖。
 *
 * 任何「该字面量是不是 super / 该 class 是不是 thread」都从此处取，避免散落字面量漂移。
 *
 * 设计权威：`.ooc-world-meta/.../children/object/self.md`（注册 class id）+
 *   `.ooc-world-meta/.../children/reflectable/self.md`（super sessionId 约定）。
 */

// ─────────────────────────── super flow 约定 ───────────────────────────

/** super flow 受保护 sessionId（reflectable 自我迭代通道）。 */
export const SUPER_SESSION_ID = "super";

/** talk_window.target 的自指别名值；解析为 caller 自己的 super 分身。 */
export const SUPER_ALIAS_TARGET = SUPER_SESSION_ID;

/** 大小写无关校验 'super'；防 HFS+ 等大小写不敏感文件系统绕过。 */
export function isSuperSessionId(sessionId: string): boolean {
  return sessionId.trim().toLowerCase() === SUPER_SESSION_ID;
}

// ─────────────────────────── 注册 class id ───────────────────────────

/** 唯一会话载体注册 class（所有会话窗 inst.class 都是它）。 */
export const THREAD_CLASS_ID = "_builtin/agent/thread";

/** thread 是不是「会话型」窗的载体 class —— 当前只 thread 一个，但 readable 路由用它筛。 */
export function isTalkLikeClass(cls: string | undefined): boolean {
  return cls === THREAD_CLASS_ID;
}

/** knowledge 子对象的注册 class id（knowledge_base 经 open_knowledge 实例化的 doc 窗）。 */
export const KNOWLEDGE_CLASS_ID = "_builtin/knowledge_base/knowledge";

export function isKnowledgeClass(cls: string | undefined): boolean {
  return cls === KNOWLEDGE_CLASS_ID;
}

/** file 对象的注册 class id（filesystem.open_file / search.open_match 实例化）。 */
export const FILE_CLASS_ID = "_builtin/filesystem/file";

export function isFileClass(cls: string | undefined): boolean {
  return cls === FILE_CLASS_ID;
}

/** pr 评审窗注册 class id。 */
export const PR_CLASS_ID = "_builtin/agent/pr";
