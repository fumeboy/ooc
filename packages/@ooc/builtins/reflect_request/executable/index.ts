/**
 * reflect_request window —— reflectable 的具体落脚点（前门）。
 *
 * super flow 反思 thread 的**会话面**（取代 creator talk_window）+ **沉淀方法挂载窗**：
 * - 会话：复用 talk 的 readable/compressView/onClose + say/wait/close/set_transcript_window
 *   （同形会话窗；ReflectRequestWindow = TalkWindow 形 + class:"reflect_request"）。
 *   报回 caller 的双通道（end 自动代发 / worker 兜底扫描）经 isTalkLikeClass 同时认本 class。
 * - 沉淀：挂 new_feat_branch / create_pr_and_invite_reviewers（标 for_reflectable，仅 super flow surface，
 *   per-window 方法菜单使它们只在 reflect_request 在场时出现 —— 取代旧的 root method「存在即有效」）。
 *
 * pr 评审窗（reviewer 侧）是另一个 class（见 @ooc/builtins/pr），reflect_request 不承担评审；二者永不共存于同一 thread。
 */

import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import {
  renderTalkWindow,
  compressTalkWindow,
  onCloseTalkWindow,
  filterMessagesForTalkWindow,
} from "@ooc/core/executable/windows/talk/index.js";
import { sayMethod } from "@ooc/builtins/thread/executable/method.say.js";
import { waitMethod } from "@ooc/core/executable/windows/talk/method.wait.js";
import { closeMethod } from "@ooc/core/executable/windows/talk/method.close.js";
import { setTranscriptWindowCommandForTalk } from "@ooc/core/executable/windows/talk/method.set-transcript-window.js";
import type { TalkWindow } from "@ooc/core/executable/windows/talk/types.js";
import { newFeatBranchMethod } from "../method.new-feat-branch.js";
import { createPrAndInviteReviewersMethod } from "../method.create-pr-and-invite-reviewers.js";

// reflect_request 类的单处声明：executable（会话 method + reflectable 沉淀 method）+ readable 维度
// （复用 talk 的 readable / windowMethods / compressView / onClose / consumedMessageIds）+ 可见性 flag。
// renderableVisible:true 但 **不** builtinReadable（与 pr 同——保留沿继承链/stone 解析的差异）。parentClass:null。
builtinRegistry.registerWindowClass({
  type: "reflect_request",
  parentClass: null,
  methods: {
    // 会话 method（复用 talk）
    say: sayMethod,
    wait: waitMethod,
    close: closeMethod,
    // reflectable 沉淀 method（for_reflectable：仅 super flow surface）
    new_feat_branch: newFeatBranchMethod,
    create_pr_and_invite_reviewers: createPrAndInviteReviewersMethod,
  },
  // 与 talk_window 一致：Object 内置特性，inline 进所属 thread 的 thread-context.json，不写独立 dir。
  isBuiltinFeature: true,
  windowMethods: {
    set_transcript_window: setTranscriptWindowCommandForTalk,
  },
  onClose: onCloseTalkWindow,
  readable: renderTalkWindow,
  compressView: compressTalkWindow,
  consumedMessageIds: (ctx) =>
    filterMessagesForTalkWindow(ctx.window as TalkWindow, ctx.thread),
  renderableVisible: true,
});
