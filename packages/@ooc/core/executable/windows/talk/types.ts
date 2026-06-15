/**
 * talk —— 会话 class 的 **object data** 结构（types.ts = 纯 Data）+ 投影态 Win。
 *
 * talk_window 与"对端某条 thread"保持持续会话，统一两种会话形态（2026-06-14，do_window 并入）：
 *
 * **A. peer 会话（跨对象）**：与另一个 flow object 通信（target=peer objectId / "user"）。
 *    `say` 走 talk-delivery 磁盘派送；transcript 按 windowId 过滤。
 * **B. fork 子线程（同对象，= 旧 do_window）**：talk 自己（target=自己的 objectId）⇒ fork 一条新子线程；
 *    `isForkWindow=true`，`targetThreadId`=子线程 id；`say` 走内存树寻址（同 session 同 job、不付磁盘 IO）；
 *    transcript 按 targetThreadId 过滤。
 *
 * Wave 4 对象模型：信封字段（id / class / title / status / createdAt / parentObjectId）由 runtime
 * 管理（`OocObjectInstance` 信封），**不**进本 Data；展示态（transcript viewport）归投影态 `Win`。
 * 本 Data 只含会话业务字段。
 */
export interface TalkData {
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

/** talk 的**投影态**（与 Data 分离）：transcript 渲染窗口。window method `set_transcript_window` 读写。 */
export interface TalkWin {
  transcriptViewport?: import("../_shared/transcript-viewport.js").TranscriptViewport;
}

/**
 * delivery 域内部的**扁平派送视图 DTO**（实例 id/class 信封 + TalkData 扁平）。
 * 非持久化结构——say / fork 派送时把 `OocObjectInstance<TalkData>` 还原成 delivery 期望的扁平面；
 * 取代 Wave 4 前的全局 `TalkWindow` 平铺别名（已随 union 收口删除）。
 */
export interface TalkWindowView extends TalkData {
  id: string;
  class: string;
}
