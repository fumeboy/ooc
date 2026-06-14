import type { BaseContextWindow } from "../_shared/types.js";
import type { TranscriptViewport } from "../_shared/transcript-viewport.js";

/**
 * Talk window — 与"对端某条 thread"保持持续会话。统一了两种会话形态（2026-06-14，do_window 并入）：
 *
 * **A. peer 会话（跨对象）**：与另一个 flow object 通信（target=peer objectId / "user"）。
 *    `say` 走 talk-delivery 磁盘派送；transcript 按 windowId 过滤。
 * **B. fork 子线程（同对象，= 旧 do_window）**：talk 自己（target=自己的 objectId）⇒ fork 一条新子线程；
 *    `isForkWindow=true`，`targetThreadId`=子线程 id；`say` 走内存树寻址（同 session 同 job、不付磁盘 IO）；
 *    transcript 按 targetThreadId 过滤；支持 `move`（share_windows）。
 *
 * 字段：
 * - target：对端 objectId（peer），或自己的 objectId（fork）。
 * - targetThreadId：对端 thread id。peer：首次 say 时由 talk-delivery 回填；fork：建窗即知（子线程 id）。
 * - isForkWindow：true ⇒ 形态 B（同对象子线程）；缺省/false ⇒ 形态 A（跨对象 peer）。
 * - conversationId：同 target 多窗口区分；当前固定等于 windowId。
 * - isCreatorWindow：指向 caller 的初始 creator 窗（不可 close）。creator 窗按 attention 分层渲染为句柄。
 * - status：open / closed（旧 do 的 archived 映射为 closed；子线程"运行中"状态挂 thread.status，不在窗上）。
 * - 注册的 method：say / wait / close / talk(构造) / move(fork) / set_transcript_window。
 */
export interface TalkWindow extends BaseContextWindow {
  class: "talk";
  /** 对端 objectId（peer 会话）或自己的 objectId（fork 子线程）。 */
  target: string;
  /** 对端 thread id；peer 首条 say 时回填，fork 建窗即知。 */
  targetThreadId?: string;
  /** true ⇒ fork 子线程窗（同对象，旧 do_window）；缺省 ⇒ peer 跨对象会话窗。 */
  isForkWindow?: boolean;
  conversationId: string;
  status: "open" | "closed";
  /** 标记为初始 creator 窗（指向 caller），不可被 close。 */
  isCreatorWindow?: boolean;
  /** @deprecated 移到 state.transcriptViewport（WindowDisplayState）；保留以兼容旧 thread.json。 */
  transcriptViewport?: TranscriptViewport;
}
