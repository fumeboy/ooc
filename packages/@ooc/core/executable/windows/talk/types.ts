import type { BaseContextWindow } from "../_shared/types.js";
import type { TranscriptViewport } from "../_shared/transcript-viewport.js";

/**
 * Talk window — 与另一个 flow object 的某条 thread 保持持续会话。
 *
 * collaborable § cross-object talk（spec 2026-05-15）：
 * - target：目标 flow object 的 objectId；user 也是一个 flow object，写作 "user"
 * - targetThreadId：会话对端 thread id；首次 say 时由 talk-delivery 创建并回填
 * - conversationId：同 target 多窗口区分；当前固定等于 windowId
 * - isCreatorWindow：标记为"指向 caller 的初始 creator talk_window"（不可被 LLM close）
 * - transcriptViewport：transcript 渲染窗口（tail / range 互斥）；默认 tail=20；
 *   通过 set_transcript_window 命令调整；详见 _shared/transcript-viewport.ts
 * - 注册的 command（windows/talk/index.ts）：say / wait / close / set_transcript_window
 * - 视图：transcript 按 outbox.windowId === self.id || inbox.replyToWindowId === self.id 过滤
 */
export interface TalkWindow extends BaseContextWindow {
  type: "talk";
  /** 目标 flow object id；"user" 也是一个 object。 */
  target: string;
  /** 对端 thread id；首条消息派送时由 talk-delivery 解析/创建并回填。 */
  targetThreadId?: string;
  conversationId: string;
  status: "open" | "closed";
  /** 标记为初始 creator talk_window（callee thread 自带的、指向 caller 的那一条），不可被 close。 */
  isCreatorWindow?: boolean;
  /** transcript 渲染窗口；缺省 = DEFAULT_TRANSCRIPT_VIEWPORT（tail=20）。详见 _shared/transcript-viewport.ts。 */
  transcriptViewport?: TranscriptViewport;
}
