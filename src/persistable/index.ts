/**
 * src/persistable — Object 三层持久化的统一 export 入口。
 *
 * 详见 meta/object.doc.ts:persistable 子树 + spec §2.
 */

export * from "./object-record";
export * from "./uri";
export * from "./world-config";

// common.ts: thread/stone/flow persistence refs + path helpers
export type { FlowObjectRef, ThreadPersistenceRef, StoneObjectRef } from "./common";
export {
    objectDir,
    stoneDir,
    threadDir,
    deriveStoneFromThread,
    nestedObjectPath,
    STONE_OBJECTS_SUBDIR,
    STONE_CHILDREN_SUBDIR,
} from "./common";

// pool-object.ts: pool data management
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

// csv-pool.ts: CSV file pool
export { readCsv, writeCsv, appendRow } from "./csv-pool";

// flow-object.ts: flow session + object creation
export {
    createFlowSession,
    createFlowObject,
    flowMetadataFile,
    sessionDir,
    sessionMetadataFile,
    type FlowSessionMetadata,
    type FlowObjectMetadata,
} from "./flow-object";

// serial-queue.ts: serialized async fs writes
export { enqueueSessionWrite, __resetSerialQueueForTests } from "./serial-queue";

// stone-bootstrap.ts: git repository initialization
export {
    ensureStoneRepo,
    STONES_MAIN_BRANCH,
    type EnsureStoneRepoResult,
} from "./stone-bootstrap";

// stone-git.ts: git CLI wrappers
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
} from "./stone-git";

// stone-versioning.ts: P2 stub (full implementation P5+)
export {
    openMetaprogWorktree,
    commitWorktree,
    tryMergeSelf,
    requestPrIssueReview,
    pruneStaleWorktrees,
    SUPERVISOR_OBJECT_ID,
    type MetaprogWorktreeRef,
    type TryMergeSelfResult,
    type RequestPrIssueResult,
} from "./stone-versioning";

// versioned-write.ts: stone write versioning wrapper
export {
    versionedStoneWrite,
    type VersionedStoneWriteInput,
    type VersionedWriteContext,
    type VersionedWriteOk,
    type VersionedWriteErr,
} from "./versioned-write";

// debug-file.ts: LLM debug snapshots
export {
    llmInputFile,
    llmOutputFile,
    loopInputFile,
    loopOutputFile,
    loopMetaFile,
    normalizeInputItems,
    deriveOutputItems,
    writeDebugInput,
    writeDebugOutput,
    writeLoopDebugInput,
    writeLoopDebugOutput,
    writeLoopDebugMeta,
    readLoopDebugMeta,
    type ContextSnapshot,
    type LlmInputDebugRecord,
    type LlmOutputDebugRecord,
    type LlmLoopDebugMetaRecord,
} from "./debug-file";

// 内部辅助模块按需选择性 re-export；调用方可直接从子模块 import
// (csv-pool / pool-object / stone-bootstrap / stone-git / versioned-write /
//  serial-queue / debug-file / common 等)
