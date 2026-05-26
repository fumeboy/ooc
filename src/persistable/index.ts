export type { FlowObjectRef, ThreadPersistenceRef, StoneObjectRef } from "./common";
export { objectDir, stoneDir, threadDir, deriveStoneFromThread, STONE_OBJECTS_SUBDIR } from "./common";

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
  type ContextSnapshot,
  type LlmInputDebugRecord,
  type LlmOutputDebugRecord,
  type LlmLoopDebugMetaRecord
} from "./debug-file";

export {
  createStoneObject,
  serverDir,
  clientDir,
  stoneKnowledgeDir,
  stoneChildrenDir,
  ancestorObjectIds,
  stoneMetadataFile,
  type StoneObjectMetadata
} from "./stone-object";

export {
  flowRelationsDir,
  flowRelationFile,
  readFlowRelation,
  writeFlowRelation,
} from "./flow-relation";

export { readSelf, selfFile, writeSelf } from "./stone-self";
export { readReadme, readmeFile, writeReadme } from "./stone-readme";
// stone-data 已删除（2026-05-23）：data.json 语义改为 session-scoped 落 flow（详见 ./flow-data）。
export { readServerSource, serverIndexFile, writeServerSource } from "./stone-server";

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

export { enqueueSessionWrite, __resetSerialQueueForTests } from "./serial-queue";
export {
  ensureStoneRepo,
  STONES_MAIN_BRANCH,
  type EnsureStoneRepoResult,
} from "./stone-bootstrap";

export {
  // U3: git CLI 薄包装（仅供 stone-versioning 等高层编排使用）
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

export {
  // U4: 高层 stone-versioning 编排
  openMetaprogWorktree,
  commitWorktree,
  classifyWorktreeBranch,
  tryMergeSelf,
  requestPrIssueReview,
  resolvePrIssue,
  rollback,
  supervisorCreateObject,
  pruneStaleWorktrees,
  SUPERVISOR_OBJECT_ID,
  type MetaprogWorktreeRef,
  type ScopeClass,
  type PrIssueDecision,
  type RollbackInput,
  type RollbackResult,
  type SupervisorCreateObjectInput,
  type SupervisorCreateObjectResult,
  type TryMergeSelfResult,
  type RequestPrIssueResult,
  type ResolvePrIssueResult,
} from "./stone-versioning";
export { parseMentions } from "./mention";

export {
  clientIndexFile,
  flowClientPageFile,
  flowClientPagesDir,
  readFlowClientPage,
  readStoneClientSource,
  writeFlowClientPage,
  writeStoneClientSource,
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
