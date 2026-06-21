export type { FlowObjectRef, ThreadPersistenceRef, StoneObjectRef } from "./common";
export {
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
} from "./common";

export type { PoolObjectRef, PoolObjectMetadata } from "./pool-object";
export {
  POOL_OBJECTS_SUBDIR,
  poolDir,
  poolMetadataFile,
  poolKnowledgeDir,
  poolKnowledgeMemoryDir,
  poolKnowledgeRelationsDir,
  poolKnowledgeRelationFile,
  poolFilesDir,
  poolDataDir,
  poolDataFile,
  readPoolRelation,
  createPoolObject,
  derivePoolFromThread,
} from "./pool-object";

export { readCsv, writeCsv, appendRow } from "./csv-pool";

// flow-data（data.json IO）已下沉 interpreter builtin（InterpreterSelf.getData/setData 独占）：
// @ooc/builtins/interpreter/children/interpreter_process/persistable/flow-data.ts

export {
  createFlowSession,
  createFlowObject,
  flowMetadataFile,
  readFlowObjectClass,
  sessionDir,
  sessionMetadataFile,
  ClassNotFoundError,
  type FlowSessionMetadata,
  type FlowObjectMetadata
} from "./flow-object";

export {
  createStoneObject,
  executableDir,
  visibleDir,
  stoneKnowledgeDir,
  stoneChildrenDir,
  ancestorObjectIds,
  discoverStoneHierarchicalPeers,
} from "./stone-object";

export {
  writeRuntimeObjectState,
  readRuntimeObjectState,
} from "./flow-runtime-object";

export {
  // stone-worktree: session identity 的 worktree 统一访问层（取代 plain overlay）
  resolveStoneIdentityDir,
  resolveStoneIdentityRef,
  sessionStoneBranch,
  sessionWorktreePath,
  sessionUsesWorktree,
  ensureSessionWorktree,
} from "./stone-worktree";

export {
  // createObjectInSession: 在业务 session worktree 建新对象骨架（不 commit，create_pr_and_invite_reviewers 合入）
  createObjectInSession,
  type CreateObjectInSessionInput,
  type CreateObjectInSessionResult,
} from "./stone-create-object";
export { readStoneClass } from "./stone-class";
export { resolveBuiltinDir, resolveBuiltinReadDir } from "./builtin-dir";
export {
  readReadable,
  readableFile,
  writeReadable,
} from "./stone-readable";
// stone-data 已删除：data.json 语义改为 session-scoped 落 flow（IO 实现已下沉 interpreter builtin，见上）。
export {
  readExecutableSource,
  executableIndexFile,
  writeExecutableSource,
} from "./stone-server";

// PR-Issue 账本已下沉 pr builtin（PR 下沉 P3）：
// @ooc/builtins/agent/children/pr/persistable/pr-issue.ts —— 消费方直接 import 该路径，
// 不再经 persistable barrel（core 维度包不可 re-export builtin 物）。

export { enqueueSessionWrite, __resetSerialQueueForTests } from "../runtime/serial-queue.js";

// STONES_MAIN_BRANCH canonical 源已迁入 ./common（打破 pr-issue → bootstrap 反向依赖）。
export { STONES_MAIN_BRANCH } from "./common";

// super-flow actor 冒泡（reflectable 新对象自沉淀 bootstrap）：super-alias 的 callee
// 解析——canonical caller 透明、新对象冒泡到最近 canonical 祖先、顶层兜底 supervisor。
export {
  resolveSuperActor,
  isCanonicalObject,
  SUPER_ACTOR_FALLBACK,
} from "./super-actor.js";

// git / versioning 编排（stone-git / stone-bootstrap / stone-versioning / stone-feat-branch）。
// persistable/index re-export 这些符号，作为 `@ooc/core/persistable` barrel 的统一对外面。
export {
  ensureStoneRepo,
  type EnsureStoneRepoResult,
} from "./stone-bootstrap.js";

export {
  // git CLI 薄包装（仅供 versioning 等高层编排使用）
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
  // 高层 versioning 编排（治理 rollback + 控制面直写 main + PR-Issue interim 合入）。
  // session→main 合入语义（tryMergeSelf/classifyWorktreeBranch/requestPrIssueReview）已退役
  // （地基不变量）；沉淀走 stone-feat-branch（createFeatBranchWorktree + commitAndOpenPr）。
  rollback,
  httpDirectMainWrite,
  SUPERVISOR_OBJECT_ID,
  type RollbackInput,
  type RollbackResult,
  type HttpDirectMainWriteInput,
  type HttpDirectMainWriteResult,
} from "./stone-versioning.js";

export {
  // stone-feat-branch: reflectable 沉淀的 feat-branch PR 路径（取代退役的 session→main 合入）。
  // 改写：createFeatBranchWorktree（开分支不写文件）+ commitAndOpenPr（finalizer）
  // 由 super(foo) thread 的 feat 分支绑定串起来；编辑走普通 write_file / file_window.edit。
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

export { parseMentions } from "@ooc/core/_shared/utils/mention.js";

export {
  flowClientPageFile,
  flowClientPagesDir,
  readFlowClientPage,
  writeFlowClientPage,
} from "./stone-client";
export type { WorldConfig } from "./world-config";
export {
  DEFAULT_SITE_NAME,
  DEFAULT_LARK_TENANT_HOST,
  WORLD_CONFIG_FILENAME,
  readWorldConfig,
  readWorldConfigSync,
  clearWorldConfigCache,
} from "./world-config";
