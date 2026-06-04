export type {
  ActivatesOn,
  ActivationLevel,
  ActivationResult,
  KnowledgeDoc,
  KnowledgeFrontmatter,
  KnowledgeIndex
} from "./types";
export { parseKnowledgeFile } from "./parser";
export { clearKnowledgeLoaderCache, loadKnowledgeIndex, type KnowledgeLoadRefs } from "./loader";
export { computeActivations } from "./activator";
export {
  evaluateTrigger,
  maxLevel,
  parseActivatesOn,
  parseTrigger,
  type Trigger,
} from "./triggers";
export { BASIC_KNOWLEDGE_PATH, KNOWLEDGE } from "./basic-knowledge";
export {
  computeFormKnowledgeEntries,
  enrichFormMethodKnowledge,
  derivePeerObjectWindows,
  ensureSelfObjectTypeRegistered,
  readSelfPrototype,
  // @deprecated Phase F: use ContextPipeline instead
  collectExecutableKnowledgeEntries,
  // @deprecated Phase F: replaced by derivePeerObjectWindows; kept for test compat
  deriveRelationWindow,
  deriveRelationCompanionKnowledge,
  deriveRelationKnowledge,
} from "./synthesizer";
