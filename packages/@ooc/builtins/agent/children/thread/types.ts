/**
 * thread —— object data 结构（types.ts = 纯 Data）+ 投影态 Win。
 *
 * thread 是 agent 一次智能运行的载体，也是**唯一**会话载体注册 class（设计权威：thinkable
 * `knowledge/thread.md` + `context.md` 核心 2/8/9）。所有会话窗（creator/peer/sub/fork）都是
 * thread 实例（inst.class=`_builtin/thread`）；talk / reflect_request 不是注册 class，而是 thread
 * readable 按视角（POV）投影出的 window class。
 *
 * **ThreadData**（inst.data）= 会话窗状态（指向某 thread 的引用）：target / targetThreadId /
 * isForkWindow / conversationId。creator 窗身份编码在 id（`creatorWindowIdOf`）里，不存 flag；
 * 投影 class 由窗形态 + id 派生的 self/other-view + thread session 算出，不持久化。
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
  /** 同 target 多窗口区分；当前固定等于 windowId（= 实例 id）。 */
  conversationId: string;
}

/** thread 的**投影态**（与 Data 分离）：transcript 渲染窗口。window method `set_transcript_window` 读写。 */
export interface ThreadWin {
  transcriptViewport?: import("@ooc/core/_shared/types/viewport.js").TranscriptViewport;
}

/**
 * talk-family 别名（talk 实现物归 thread 包后的会话业务类型）。
 *
 * 会话窗 inst.class 一律 = `_builtin/thread`；`talk` / `reflect_request` 是 thread readable 投影
 * 出的 window class。会话实现（delivery / fork / render）按这些别名消费 thread 的会话业务 Data。
 */
export type TalkData = Data;
export type TalkWin = ThreadWin;

/**
 * delivery 域内部的**扁平派送视图 DTO**（实例 id/class 信封 + TalkData 扁平）。
 * 非持久化结构——say / fork 派送时把 `OocObjectInstance<TalkData>` 还原成 delivery 期望的扁平面。
 */
export interface TalkWindowView extends TalkData {
  id: string;
  class: string;
}
