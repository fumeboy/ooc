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
 * @deprecated 过渡别名 —— 旧 `TalkWindow`（窗即平铺 struct）的窗信封视图。
 *
 * 新契约里业务数据（target / targetThreadId / isForkWindow / isCreatorWindow / conversationId）
 * 落 `OocObjectInstance.data`（=`TalkData`），投影态落 `.win`（=`TalkWin`），信封字段（id / class /
 * title / status / createdAt / parentWindowId）由 runtime 管理。仍以「窗」整体看待 talk 投影的
 * 域外消费方（flows/model.ts、context/index.ts、web、_shared 的 ContextWindow union…）继续引本交叉
 * 类型让其编译。talk-family 全量迁移落定后归并删除。
 */
export type TalkWindow = TalkData & {
  id: string;
  class: "talk";
  title?: string;
  status?: "open" | "closed";
  createdAt?: number;
  parentWindowId?: string;
  /** @deprecated 旧 transcript viewport 平铺字段（已移到投影态 win）。 */
  transcriptViewport?: import("../_shared/transcript-viewport.js").TranscriptViewport;
  state?: { transcriptViewport?: import("../_shared/transcript-viewport.js").TranscriptViewport };
  [key: string]: unknown;
};
