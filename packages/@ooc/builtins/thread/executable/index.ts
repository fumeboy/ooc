/**
 * thread —— executable 维度。thread 是唯一会话载体注册 class；它持有全部会话 object method：
 *   - say / close / share              —— 会话 3 method（session-methods.ts）
 *   - new_feat_branch                  —— reflectable 沉淀第一步（for_reflectable）
 *   - create_pr_and_invite_reviewers   —— reflectable 沉淀 finalizer（for_reflectable）
 *
 * 沉淀两 method 标 `for_reflectable:true`：注册在 thread class 上，但仅在 reflect_request 投影窗
 * （super flow self-view）的 window decl 里 surface（见 readable 的 3 个 window decl）。
 *
 * 注：**wait 是 3 原语之一（非 method）**，经 `core/executable/tools/wait.ts` 独立 tool 入口。
 */
import type { ExecutableModule } from "@ooc/core/executable/contract.js";
import { sessionMethods } from "./session-methods.js";
import { newFeatBranchMethod } from "./method.new-feat-branch.js";
import { createPrAndInviteReviewersMethod } from "./method.create-pr-and-invite-reviewers.js";
import type { Data } from "../types.js";

const executable: ExecutableModule<Data> = {
  methods: [
    ...sessionMethods,
    newFeatBranchMethod,
    createPrAndInviteReviewersMethod,
  ],
};

export default executable;
