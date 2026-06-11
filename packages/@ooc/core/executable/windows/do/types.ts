import type { BaseContextWindow } from "../_shared/types.js";
import type { TranscriptViewport } from "../_shared/transcript-viewport.js";

/**
 * Do window — fork 子线程后在父线程下产生的对话窗口。
 *
 * - targetThreadId：fork 出的 child thread id；transcript 视图按它过滤 inbox/outbox
 * - 注册的 method（详见 windows/do/index.ts）：continue / wait / close / set_transcript_window
 * - close 语义（B=ii archive）：标记 child thread 为 archived 状态；对应 onClose hook
 * - 特殊子类：初始 creator do_window（id 派生自 thread.id，targetThreadId=creator），不可被 close
 * - transcriptViewport：transcript 渲染窗口（tail / range 互斥）；默认 tail=20；
 *   通过 set_transcript_window 命令调整；详见 _shared/transcript-viewport.ts
 */
export interface DoWindow extends BaseContextWindow {
  class: "do";
  targetThreadId: string;
  status: "running" | "archived";
  /** 标记为初始 creator do_window，不可被 LLM close（初始 creator 对话 window）。 */
  isCreatorWindow?: boolean;
  /** @deprecated 移到 state.transcriptViewport（WindowDisplayState）；保留以兼容旧 thread.json。 */
  transcriptViewport?: TranscriptViewport;
}
