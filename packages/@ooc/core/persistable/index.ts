/**
 * persistable —— 三层存储 (stones / flows / pools) 物理 IO 入口 barrel。
 *
 * 仅 re-export 仍存在的模块；旧 PR-Issue / pool / object-data / super-actor / stone-readable
 * 等已退役模块的 re-export 已清。
 */
export {
  // common: refs + path helpers + 常量
  objectDir,
  stoneDir,
  resolveStoneDir,
  threadDir,
  deriveStoneFromThread,
  nestedObjectPath,
  STONE_OBJECTS_SUBDIR,
  STONE_CHILDREN_SUBDIR,
  BUILTIN_OBJECT_IDS,
  isBuiltinObjectId,
  STONES_MAIN_BRANCH,
} from "./common.js";
export type { FlowObjectRef, ThreadPersistenceRef, StoneObjectRef } from "./common.js";

export {
  createFlowSession,
  createFlowObject,
  flowMetadataFile,
  readFlowObjectClass,
  sessionDir,
  sessionMetadataFile,
  ClassNotFoundError,
  type FlowSessionMetadata,
  type FlowObjectMetadata,
} from "./flow-object.js";

export {
  executableDir,
  visibleDir,
  stoneKnowledgeDir,
  stoneChildrenDir,
  ancestorObjectIds,
  discoverStoneHierarchicalPeers,
} from "./stone-object.js";

export {
  resolveStoneIdentityDir,
  resolveStoneIdentityRef,
  sessionStoneBranch,
  sessionWorktreePath,
  sessionUsesWorktree,
  ensureSessionWorktree,
} from "./stone-worktree.js";

export { readStoneClass } from "./stone-class.js";
export { resolveBuiltinDir, resolveBuiltinReadDir } from "./builtin-dir.js";
export {
  readExecutableSource,
  executableIndexFile,
  writeExecutableSource,
} from "./stone-server.js";

export { enqueueSessionWrite, __resetSerialQueueForTests } from "../runtime/serial-queue.js";

export {
  ensureStoneRepo,
  type EnsureStoneRepoResult,
} from "./stone-bootstrap.js";

export {
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
} from "./stone-git.js";

export {
  rollback,
  httpDirectMainWrite,
  SUPERVISOR_OBJECT_ID,
  type RollbackInput,
  type RollbackResult,
  type HttpDirectMainWriteInput,
  type HttpDirectMainWriteResult,
} from "./stone-versioning.js";

export {
  computeReviewerSet,
  createFeatBranchWorktree,
  commitFeatAndDiff,
  unregisterFeatWorktree,
  slugFromIntent,
  featBranchName,
  featWorktreePath,
  type CreateFeatBranchWorktreeInput,
  type CreateFeatBranchWorktreeResult,
  type CommitAndOpenPrInput,
  type CommitFeatAndDiffResult,
  type PrPayloadDraft,
} from "./stone-feat-branch.js";

export { parseMentions } from "@ooc/core/utils/mention.js";

export {
  flowClientPageFile,
  flowClientPagesDir,
  readFlowClientPage,
  writeFlowClientPage,
} from "./stone-client.js";

export type { WorldConfig } from "./world-config.js";
export {
  DEFAULT_SITE_NAME,
  DEFAULT_LARK_TENANT_HOST,
  WORLD_CONFIG_FILENAME,
  readWorldConfig,
  readWorldConfigSync,
  clearWorldConfigCache,
} from "./world-config.js";
