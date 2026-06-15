/**
 * transcript viewport 协议 re-export — talk_window（peer 会话 + fork 子窗）的"持续对话窗口节流"控制。
 *
 * 纯类型 + 纯函数（`TranscriptViewport` / `mergeTranscriptViewport` /
 * `applyTranscriptViewport` / …）的 canonical 源是 `@ooc/core/_shared/types/viewport.ts`；
 * 此处 re-export 保持旧 import 路径可用。各 class 的 readable 经新 `WindowMethod`
 * （`readable/contract.ts`，签名 `(ctx, self, before_win, args) => Win`）自行装配
 * set_transcript_window，不再走集中执行体。
 */

export * from "../_shared/types/viewport.js";
