/**
 * reflect_request.create_pr_and_invite_reviewers method —— reflectable 沉淀的 finalizer（feat-branch PR 路径）。
 *
 * 挂在 reflect_request class 上（super flow 反思会话面），标 for_reflectable（仅 super flow surface）。
 * 旧名 evolve_self 已退役——名副其实：它就是 commit feat worktree → 算 reviewer 集 → createPrIssue
 * → 投递 pr_window 给各 reviewer。
 *
 * 地基不变量（用户拍板）：`session-<sid>` worktree 是纯运行时派生物，**永不合入 main**。
 * 沉淀知识/功能进 canonical 要走「另起 feat 分支 → 直接编辑 → commit → PR → review → merge」。
 *
 * 沉淀**第三步（finalizer）**，**不吃 edits 参数**。完整序列：
 *   1. new_feat_branch(intent)  —— 开 feat 分支并绑定本 thread。
 *   2. write_file / file_window.edit ×N —— 直接编辑 feat worktree 下文件（绑定覆盖优先路由）。
 *   3. create_pr_and_invite_reviewers —— 读 thread 的 feat 绑定 → commit 该 feat worktree（署名 foo）
 *      → computeReviewerSet 冒泡 reviewer → createPrIssue 开 PR → 投递 pr_window → **清除绑定**。
 *
 * 合入闸：reviewer 集**强制聚合执行**——`aggregatePrApproval` 要求全员 approve 才 ready-to-merge
 * （reject 一票否决），再由 `.world.json prAutoMerge` 决定自动/人工合入（编排见 @ooc/builtins/pr/approval-flow.ts）。
 *
 * deferred（旧 intents UI hook）：旧契约里本方法带 intents("create_pr_and_invite_reviewers") 供前端；
 * 新 ObjectMethod 契约不含该字段（见第六节 core 反推统一 UI hook）。提示文案保留为 CREATE_PR_TIP 局部常量。
 */

import type {
  ExecutableContext,
  ObjectMethod,
} from "@ooc/core/executable/contract.js";
import { commitAndOpenPr } from "@ooc/core/persistable/index.js";
import { deliverPrWindowToReviewers } from "@ooc/builtins/pr/delivery.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";
import type { Data } from "../types.js";

const CREATE_PR_TIP = `create_pr_and_invite_reviewers 是 super flow 沉淀的 finalizer（feat 分支 → commit → PR）。
前置：先 new_feat_branch(intent) 开分支绑定本 thread，再用 write_file / file_window.edit 直接编辑
feat worktree 下文件（stones/<id>/...）。本方法读绑定、commit 你的编辑、开 PR 邀请 reviewer 评审合入。
参数：intent（可选，覆盖 new_feat_branch 时的沉淀意图作 PR 标题；缺省沿用绑定的 intent）。`;

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export const createPrAndInviteReviewersMethod: ObjectMethod<Data> = {
  name: "create_pr_and_invite_reviewers",
  description:
    "In super flow: commit the bound feat branch, open a PR and invite the bubbled reviewer set. Requires new_feat_branch first.",
  for_reflectable: true,
  schema: {
    args: {
      intent: {
        type: "string",
        required: false,
        description: "可选，覆盖沉淀意图作 PR 标题；缺省沿用 new_feat_branch 的 intent",
      },
    },
  },
  exec: (ctx, _self, args) => executeCreatePrAndInviteReviewers(ctx, args),
};

export async function executeCreatePrAndInviteReviewers(
  ctx: ExecutableContext,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const thread = ctx.thread;
  if (!thread) return "[create_pr_and_invite_reviewers] 缺少 thread context。";
  if (!thread.persistence) return "[create_pr_and_invite_reviewers] thread 无 persistence。";

  const { baseDir, sessionId, objectId, stonesBranch, sedimentIntent } = thread.persistence;
  if (!isSuperSessionId(sessionId)) {
    return `[create_pr_and_invite_reviewers] 仅 super flow 内可用（当前 session='${sessionId}'）。请在业务 thread 里 talk(target="super") 触发 super flow 后再调。`;
  }

  // 无 feat 绑定 → 提示先 new_feat_branch（fail-loud）。
  if (!stonesBranch) {
    return JSON.stringify({
      ok: false,
      note: CREATE_PR_TIP,
      missing: ["feat 分支绑定（先调 new_feat_branch(intent) 开分支并编辑）"],
    });
  }

  // intent：caller 显式覆盖 > new_feat_branch 时绑定的 sedimentIntent。
  const intent = asString(args.intent)?.trim() || sedimentIntent;
  if (!intent || !intent.trim()) {
    return JSON.stringify({
      ok: false,
      note: CREATE_PR_TIP,
      missing: ["intent（绑定无 sedimentIntent 时须显式传）"],
    });
  }

  const r = await commitAndOpenPr({
    baseDir,
    branch: stonesBranch,
    authorObjectId: objectId,
    intent,
    // 回修定位：本 super(foo) thread 即发起沉淀者，reject/合入失败时 message 回投到这里。
    authorThreadId: thread.id,
  });
  if (!r.ok) {
    // NO_CHANGES（还没编辑就 finalize）等错误保留绑定，让 super(foo) 继续编辑后重试。
    return `[create_pr_and_invite_reviewers:${r.code}] ${r.message}`;
  }

  // 给每个 reviewer 的 super-session thread 投递一条 pr_window（reviewer 在 thinkloop
  // 里通过 approve/reject/request_changes 亲手批；root knowledge pr-review.md 经 object::pr 激活）。
  await deliverPrWindowToReviewers({
    baseDir,
    issueId: r.issueId,
    reviewers: r.reviewers,
    authorObjectId: objectId,
    authorThreadId: thread.id,
    title: intent.slice(0, 80),
  });

  // 成功开 PR → 清除绑定（沉淀单元已交付；后续编辑回落普通 session/main 路由）。
  thread.persistence.stonesBranch = undefined;
  thread.persistence.sedimentIntent = undefined;

  return JSON.stringify({
    ok: true,
    kind: "pr-issue",
    issueId: r.issueId,
    branch: r.branch,
    reviewers: r.reviewers,
    paths: r.paths,
    note: "已开 feat 分支 PR 交 review；已给每个 reviewer 投递 pr_window，他们 approve/reject/request_changes。绑定已清除。",
  });
}
