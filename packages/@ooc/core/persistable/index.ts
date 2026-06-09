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

export {
  flowDataFile,
  readData as readFlowData,
  writeData as writeFlowData,
  mergeData as mergeFlowData,
} from "./flow-data";

export {
  createFlowSession,
  createFlowObject,
  flowMetadataFile,
  sessionDir,
  sessionMetadataFile,
  ClassNotFoundError,
  type FlowSessionMetadata,
  type FlowObjectMetadata
} from "./flow-object";

export {
  readThread,
  threadFile,
  writeThread
} from "./thread-json";

export {
  llmInputFile,
  llmOutputFile,
  loopInputFile,
  loopOutputFile,
  loopMetaFile,
  normalizeInputItems,
  deriveOutputItems,
  captureContextSnapshot,
  writeDebugInput,
  writeDebugOutput,
  writeLoopDebugInput,
  writeLoopDebugOutput,
  writeLoopDebugMeta,
  readLoopDebugMeta,
  type ContextSnapshot,
  type LlmInputDebugRecord,
  type LlmOutputDebugRecord,
  type LlmLoopDebugMetaRecord
} from "./debug-file";

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
  flowRelationsDir,
  flowRelationFile,
  readFlowRelation,
  writeFlowRelation,
} from "./flow-relation";

// 2026-06-01 ooc-6 Phase 5'.1: flat runtime object + thread context registry
// 2026-06-02 ooc-6 Phase 5'.3: nested flow-context.ts removed; this is the only path
export {
  runtimeObjectStateFile,
  writeRuntimeObjectState,
  readRuntimeObjectState,
  deleteRuntimeObject,
  createRuntimeObject,
} from "./flow-runtime-object";
export {
  contextRegistryFile,
  readContextRegistry,
  writeContextRegistry,
  EMPTY_REGISTRY,
  type ContextRegistry,
  type ContextMember,
  type ContextParams,
} from "./flow-context-registry";

// 2026-06-02 ooc-6 P6.§6: thread context.json (state vs context split)
export {
  threadContextFile,
  writeThreadContext,
  readThreadContext,
  buildThreadContextEntries,
  type ThreadContextRef,
  type ThreadContextEntry,
  type ThreadContextFile,
} from "./flow-thread-context";

export {
  // stone-worktree: session identity 的 worktree 统一访问层（取代 plain overlay）
  resolveStoneIdentityDir,
  resolveStoneIdentityRef,
  sessionStoneBranch,
  sessionWorktreePath,
  sessionUsesWorktree,
  ensureSessionWorktree,
} from "./stone-worktree";

export { readSelf, selfFile, writeSelf } from "./stone-self";
export { readStoneClass } from "./stone-class";
export { resolveBuiltinDir, resolveBuiltinReadDir } from "./builtin-dir";
export {
  readReadable,
  readableFile,
  readableTsFile,
  writeReadable,
} from "./stone-readme";
// stone-data 已删除（2026-05-23）：data.json 语义改为 session-scoped 落 flow（详见 ./flow-data）。
export {
  readExecutableSource,
  executableIndexFile,
  writeExecutableSource,
} from "./stone-server";

export {
  // PR-Issue（stone-versioning 决策协议；issue 看板已 2026-05-26 移除）
  PR_ISSUE_SESSION_ID,
  createPrIssue,
  createRecoveryIssue,
  closePrIssue,
  readPrIssue,
  readPrIssueIndex,
  type PrIssuePayload,
  type PrIssueRecord,
  type PrIssueIndex,
  type PrIssueIndexEntry,
  type CreatePrIssueInput,
  type CreateRecoveryIssueInput,
} from "./pr-issue";

export { enqueueSessionWrite, __resetSerialQueueForTests } from "../runtime/serial-queue.js";

// STONES_MAIN_BRANCH canonical 源已迁入 ./common（打破 pr-issue → bootstrap 反向依赖）。
export { STONES_MAIN_BRANCH } from "./common";

// ooc-6 批次 E1: git / versioning 编排迁入 @ooc/core/programmable。
// persistable/index 继续 re-export 这些符号，保证 `@ooc/core/persistable` barrel 调用方零改动。
export {
  ensureStoneRepo,
  type EnsureStoneRepoResult,
} from "../programmable/bootstrap.js";

export {
  // U3: git CLI 薄包装（仅供 versioning 等高层编排使用）
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
} from "../programmable/git.js";

export {
  // U4: 高层 versioning 编排（session worktree 合入 + 治理 + 控制面直写 main）
  commitWorktree,
  classifyWorktreeBranch,
  tryMergeSelf,
  requestPrIssueReview,
  resolvePrIssue,
  rollback,
  httpDirectMainWrite,
  pruneStaleWorktrees,
  SUPERVISOR_OBJECT_ID,
  type MetaprogWorktreeRef,
  type ScopeClass,
  type PrIssueDecision,
  type RollbackInput,
  type RollbackResult,
  type HttpDirectMainWriteInput,
  type HttpDirectMainWriteResult,
  type TryMergeSelfResult,
  type RequestPrIssueResult,
  type ResolvePrIssueResult,
} from "../programmable/versioning.js";

export {
  // evolve-self: super-flow 身份合入闸门（session worktree → main）
  evolveSelfDiff,
  evolveSelfMerge,
  type EvolveSelfInput,
  type EvolveSelfDiff,
  type EvolveSelfMerged,
  type EvolveSelfErr,
} from "../programmable/evolve-self.js";

export { parseMentions } from "./mention";

export {
  flowClientPageFile,
  flowClientPagesDir,
  readFlowClientPage,
  writeFlowClientPage,
  visibleIndexFile,
  readVisibleSource,
  writeVisibleSource,
} from "./stone-client";
export type { SkillEntry } from "./stone-skills";
export {
  branchSkillsDir,
  objectSkillsDir,
  listBranchSkills,
  listObjectSkills,
  listExternalSkills,
  clearStoneSkillsCache,
} from "./stone-skills";
export type { WorldConfig } from "./world-config";
export {
  DEFAULT_SITE_NAME,
  DEFAULT_LARK_TENANT_HOST,
  WORLD_CONFIG_FILENAME,
  readWorldConfig,
  clearWorldConfigCache,
} from "./world-config";
