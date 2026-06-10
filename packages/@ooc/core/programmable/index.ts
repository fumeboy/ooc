/**
 * programmable —— metaprog / versioning 能力维度的对外 API 面（ooc-6 批次 E1）。
 *
 * 从 persistable 迁出的 git 工作流编排层（git CLI 薄包装、stones bootstrap、
 * metaprog worktree 全编排、versioned write facade）。层级规则（DECISIONS.md DD2）：
 * `programmable → persistable` 允许（versioning 建立在 raw IO 之上），反向禁止。
 */

export {
  // bootstrap: stones bare repo + main worktree 启动初始化
  ensureStoneRepo,
  STONES_MAIN_BRANCH,
  STONES_BARE_REPO_DIR,
  type EnsureStoneRepoResult,
} from "./bootstrap.js";

export {
  // git CLI 薄包装（仅供高层编排使用）
  isValidBranchName,
  gitInit,
  gitCurrentBranch,
  gitHead,
  gitRevParse,
  gitStatus,
  gitDiffNames,
  gitDiffPatch,
  gitCommit,
  gitCommitAll,
  gitBranchCreate,
  gitBranchDelete,
  gitWorktreeAdd,
  gitWorktreeRemove,
  gitWorktreeList,
  gitWorktreePrune,
  gitRebase,
  gitMergeFastForward,
  gitMergeBase,
  gitCheckout,
  gitArchiveBranch,
  type GitResult,
  type GitErrorCode,
  type CommitInput,
  type WorktreeAddInput,
  type WorktreeEntry,
} from "./git.js";

export {
  // 高层 versioning 编排（session worktree 合入 + 治理 + 控制面直写 main）
  commitWorktree,
  classifyWorktreeBranch,
  tryMergeSelf,
  requestPrIssueReview,
  resolvePrIssue,
  rollback,
  httpDirectMainWrite,
  pruneStaleWorktrees,
  SUPERVISOR_OBJECT_ID,
  type HttpDirectMainWriteInput,
  type HttpDirectMainWriteResult,
  type SessionWorktreeRef,
  type ScopeClass,
  type PrIssueDecision,
  type RollbackInput,
  type RollbackResult,
  type TryMergeSelfResult,
  type RequestPrIssueResult,
  type ResolvePrIssueResult,
} from "./versioning.js";
