/**
 * Super flow 约定常量 —— canonical 源（从
 * `executable/windows/_shared/super-constants.ts` 迁入）。
 *
 * 任何需要 "super" 字面量的代码都从 `@ooc/core/_shared` 取；旧路径
 * (executable/windows/_shared 下的 super-constants.ts) 现为 re-export 壳。
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

/**
 * "会话型" window class 谓词 —— talk / thread / reflect_request 三者同形
 *（持续会话 + creator 回报通道）。
 *
 * - talk：other-view（与对端 peer/sub thread 的对话）。
 * - thread：self-view（thread 与其 creator 的对话；普通 flow 的 creator 窗）。
 * - reflect_request：super flow 的 self-view（反思自视，额外挂沉淀 method）。
 *
 * thread / reflect_request 复用 talk 的渲染/会话/报回机制（class 链继承 talk）。凡是按
 * creator/对话语义处理会话窗的逻辑（end 自动代发回报、creator 不可关、wait、worker 兜底扫
 * callee 回报、transcript 归位），都用本谓词同时认这三个 class，避免把 self-view 窗换成
 * thread/reflect_request 后静默打断回报。
 */
export function isTalkLikeClass(cls: string | undefined): boolean {
  return cls === "talk" || cls === "thread" || cls === "reflect_request";
}
