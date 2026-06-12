import type { TalkWindow } from "@ooc/core/executable/windows/talk/types.js";

/**
 * ReflectRequestWindow —— super flow 反思 thread 的会话面 + reflectable 沉淀方法挂载窗。
 *
 * 它在 super flow 里取代 creator talk_window：形态与 TalkWindow 一致（target/targetThreadId/
 * conversationId/isCreatorWindow/state.transcriptViewport，复用 talk 的渲染与会话 method），
 * 仅 class 判别符为 "reflect_request"，从而额外挂载 new_feat_branch / create_pr_and_invite_reviewers
 * 两个沉淀方法（标 for_reflectable，只在 super flow surface）。
 *
 * 因与 talk 同形，talk 的报回-caller 双通道（end 自动代发 / worker 兜底扫描）经
 * `isTalkLikeClass` 谓词同时认 reflect_request——见 `@ooc/core/_shared/types/constants.ts`。
 */
export interface ReflectRequestWindow extends Omit<TalkWindow, "class"> {
  class: "reflect_request";
}
