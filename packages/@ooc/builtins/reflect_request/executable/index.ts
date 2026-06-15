/**
 * reflect_request —— executable 维度（reflectable 沉淀 object method）。
 *
 * reflect_request 是 super flow 反思 thread 的 self-view（`ooc.class: "_builtin/thread"`，class 链
 * reflect_request → thread → talk）。会话 method（say / wait / close / share / talk）全部经 class 链
 * 从 talk 继承；本类只提供自己的两个 **reflectable 沉淀 method**：
 *   - new_feat_branch                  —— 开 feat 分支并绑定本 thread（沉淀第一步）
 *   - create_pr_and_invite_reviewers   —— commit feat worktree、开 PR、邀 reviewer（finalizer）
 *
 * 二者标 `for_reflectable: true`——仅在 super flow（反思 session）surface（per-window 方法菜单使它们
 * 只在 reflect_request 在场时出现，取代旧的 root method「存在即有效」）。
 */
import type { ExecutableModule } from "@ooc/core/executable/contract.js";
import { newFeatBranchMethod } from "./method.new-feat-branch.js";
import { createPrAndInviteReviewersMethod } from "./method.create-pr-and-invite-reviewers.js";
import type { Data } from "../types.js";

const executable: ExecutableModule<Data> = {
  methods: [newFeatBranchMethod, createPrAndInviteReviewersMethod],
};

export default executable;
