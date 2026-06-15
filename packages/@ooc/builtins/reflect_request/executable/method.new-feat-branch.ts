/**
 * reflect_request.new_feat_branch method —— reflectable 沉淀的第一步（开 feat 分支）。
 *
 * 挂在 reflect_request class 上（super flow 反思会话面），标 for_reflectable（仅 super flow surface）。
 *
 * 地基不变量（用户拍板）：`session-<sid>` worktree 永不合入 main；沉淀进 canonical 走
 * 「另起 feat 分支 → 直接编辑 → commit → PR」。
 *
 * 本方法在 super flow 内由 super(foo)（foo 在 super session 下的 thread）调用：从 main 派生
 * 一个 feat 分支 worktree（落 `stones/<branch>/`，**不写任何文件**），把分支名绑到本 thread 的
 * persistence.stonesBranch（随 thread.json 持久化，跨 exec tick 存活）。
 *
 * 绑定生效后，super(foo) 用**普通 write_file / file_window.edit** 直接编辑该 feat worktree 下
 * 的文件（resolveStoneIdentityRef 见绑定即覆盖优先路由到 feat worktree）；编辑完调 create_pr_and_invite_reviewers
 * finalize（commit + 开 PR + 清绑定）。
 *
 * 仅 super flow 可调（沉淀单元只在 super(foo) thread 上）。
 *
 * **回修 resume 通道**：PR 被 reject / request-changes / 合入失败后，
 * super(foo) 收到回修 inbox message。此时再调 new_feat_branch(**同 intent**) 即可幂等
 * **重绑**该 feat 分支：同 intent → 同 slug → 同分支名 → git WORKTREE_EXISTS 视为成功，
 * 把分支重新绑回本 thread（request-changes 时旧 worktree 与编辑都还在，可继续改；reject
 * 后旧 worktree 已归档清理，从 main 重新派生空白副本重做）。re-edit 后再 create_pr_and_invite_reviewers 重开 PR。
 *
 * 缺参时返回 NEW_FEAT_BRANCH_TIP（下方局部常量）作为引导文案。
 */

import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import { createFeatBranchWorktree } from "@ooc/core/persistable/index.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";
import type { Data } from "../types.js";

const NEW_FEAT_BRANCH_TIP = `new_feat_branch 在 super flow 内开一个 feat 分支用于沉淀（沉淀第一步）。
参数：intent（必填，沉淀意图，派生分支名）。
开分支后本 thread 绑定该 feat worktree——之后用普通 write_file / file_window.edit 直接编辑
（路径 stones/<id>/... 会自动落 feat worktree），编辑完调 create_pr_and_invite_reviewers 提交并开 PR。`;

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export const newFeatBranchMethod: ObjectMethod<Data> = {
  name: "new_feat_branch",
  description:
    "In super flow: open a feat branch worktree for sediment and bind it to this thread (edits go via plain write_file).",
  for_reflectable: true,
  schema: {
    args: {
      intent: { type: "string", required: true, description: "沉淀意图（派生 feat 分支名）" },
    },
  },
  exec: (ctx, _self, args) => executeNewFeatBranch(ctx, args),
};

export async function executeNewFeatBranch(
  ctx: ExecutableContext,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[new_feat_branch] 缺少 thread context。";
  if (!thread.persistence) return "[new_feat_branch] thread 无 persistence。";

  const { baseDir, sessionId } = thread.persistence;
  if (!isSuperSessionId(sessionId)) {
    return `[new_feat_branch] 仅 super flow 内可用（当前 session='${sessionId}'）。请在业务 thread 里 talk(target="super") 触发 super flow 后再调。`;
  }

  const intent = asString(args.intent);
  if (!intent || !intent.trim()) {
    return JSON.stringify({ ok: false, note: NEW_FEAT_BRANCH_TIP, missing: ["intent"] });
  }

  // 已有绑定（同 thread 重复开分支）→ fail-loud 提示先 finalize，避免悬挂未提交的旧 feat 分支。
  if (thread.persistence.stonesBranch) {
    return JSON.stringify({
      ok: false,
      note: `本 thread 已绑定 feat 分支 '${thread.persistence.stonesBranch}'（intent='${thread.persistence.sedimentIntent ?? ""}'）。先 create_pr_and_invite_reviewers 提交它，再开新分支。`,
    });
  }

  const r = await createFeatBranchWorktree({ baseDir, intent });
  if (!r.ok) {
    return `[new_feat_branch:${r.code}] ${r.message}`;
  }

  // 把绑定挂到 thread.persistence（随 thinkloop tick 末 writeThread 持久化进 thread.json，
  // 经 readThread 跨 tick 恢复）。之后 write_file / file_window.edit 直接落 feat worktree。
  thread.persistence.stonesBranch = r.branch;
  thread.persistence.sedimentIntent = intent;

  return JSON.stringify({
    ok: true,
    branch: r.branch,
    note:
      `已开 feat 分支 ${r.branch} 并绑定本 thread。现在用 write_file / file_window.edit 直接编辑 ` +
      `stones/<id>/... 文件（自动落 feat worktree），编辑完调 create_pr_and_invite_reviewers 提交并开 PR。`,
  });
}
