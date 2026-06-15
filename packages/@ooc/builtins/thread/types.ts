/**
 * thread —— object data 结构（types.ts = 纯 Data）+ 投影态 Win。
 *
 * thread 是 agent 一次智能运行的载体，也是**唯一**会话载体注册 class（设计权威：thinkable
 * `knowledge/thread.md` + `context.md` 核心 2/8/9）。所有会话窗（creator/peer/sub/fork）都是
 * thread 实例（inst.class=`_builtin/thread`）；talk / reflect_request 不是注册 class，而是 thread
 * readable 按视角（POV）投影出的 window class。
 *
 * **ThreadData**（inst.data）= 会话业务字段：target / targetThreadId / isForkWindow /
 * isCreatorWindow / conversationId。投影 class 由这些形态标记 + thread session 算出，不持久化。
 * **ThreadWin**（inst.win）= 投影态：transcript 渲染窗口（window method `set_transcript_window` 读写）。
 *
 * 信封字段（id / class / title / status / createdAt / parentObjectId）由 runtime 管理
 * （`OocObjectInstance` 信封），不进 Data；thread 的过程数据（context/inbox/outbox/events/status）
 * 落 thread.json / thread-context.json，由 runtime/persistence 管理，不冗余进本 Data。
 */
export interface Data {
  /** 对端 objectId（peer 会话）或自己的 objectId（fork 子线程）。 */
  target: string;
  /** 对端 thread id；peer 首条 say 时回填，fork 建窗即知。 */
  targetThreadId?: string;
  /** true ⇒ fork 子线程窗（同对象，旧 do_window）；缺省 ⇒ peer 跨对象会话窗。 */
  isForkWindow?: boolean;
  /** 标记为初始 creator 窗（指向 caller），不可被 close。 */
  isCreatorWindow?: boolean;
  /** 同 target 多窗口区分；当前固定等于 windowId（= 实例 id）。 */
  conversationId: string;
}

/** thread 的**投影态**（与 Data 分离）：transcript 渲染窗口。window method `set_transcript_window` 读写。 */
export interface ThreadWin {
  transcriptViewport?: import("@ooc/core/executable/windows/_shared/transcript-viewport.js").TranscriptViewport;
}
